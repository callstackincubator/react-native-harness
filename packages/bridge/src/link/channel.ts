import type { Clock, Logger, TimerHandle } from "./ports.js";
import {
  CHANNEL_WINDOW,
  ENVELOPE,
  KIB,
  MAX_DATA_BYTES,
  encodeCredit,
  encodeEnvelope,
  encodeAscii,
  encodeReset,
  type ResetReason,
} from "./envelope.js";
import type { BulkMessage, BulkSource, Scheduler } from "./scheduler.js";
import {
  LinkByteLengthQueuingStrategy,
  LinkReadableStream,
  LinkWritableStream,
} from "./streams.js";

export type LinkChannelErrorReason =
  | "aborted"
  | "invalid"
  | "not-accepted"
  | "stalled"
  | "closed"
  | "stopped";

export class LinkChannelError extends Error {
  constructor(
    readonly reason: LinkChannelErrorReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "LinkChannelError";
  }
}

export interface LinkChannel {
  readonly id: string;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  abort(reason?: string): void;
  readonly credit: number;
  whenCredit(): Promise<void>;
}

export interface ChannelHost {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly scheduler: Scheduler;
  unsentBytes(): number;
  channelDone(channel: Channel): void;
}

const ACCEPT_WAIT_MS = 30_000;
const STALL_WAIT_MS = 60_000;
const WRITER_BUFFER = 64 * KIB;

interface Deferred {
  resolve(): void;
  reject(error: Error): void;
}

type QueueItem = { readonly bytes: Uint8Array; readonly payload: number; readonly end: boolean };

export class Channel implements BulkSource {
  readonly number: number;
  readonly id: string;
  readonly ownedByUs: boolean;
  accepted: boolean;
  readonly view: LinkChannel;
  readonly #host: ChannelHost;

  #failure: LinkChannelError | undefined;
  #done = false;

  #openHanded: boolean;
  #queue: QueueItem[] = [];
  #queuedBytes = 0;
  #allowance = CHANNEL_WINDOW;
  #handed = 0;
  #inFlight = 0;
  #endQueued = false;
  #endHanded = false;
  #stoppedByPeer = false;
  #pendingWrite: Deferred | undefined;
  #creditWaiters: Deferred[] = [];
  #stallTimer: TimerHandle | undefined;
  #acceptTimer: TimerHandle | undefined;

  #received = 0;
  #granted = 0;
  #readTotal = 0;
  #inQueue: Uint8Array[] = [];
  #inEnded = false;
  #stopSent = false;
  #wantRead = false;
  #readableController: ReadableStreamDefaultController<Uint8Array> | undefined;
  #writableController: WritableStreamDefaultController | undefined;

  #resetQueued = false;
  #resetHanded = false;
  #resetReceived = false;

  constructor(host: ChannelHost, number: number, id: string, ownedByUs: boolean) {
    this.#host = host;
    this.number = number;
    this.id = id;
    this.ownedByUs = ownedByUs;
    this.accepted = ownedByUs;
    this.#openHanded = !ownedByUs;
    this.view = this.#buildView();
    if (ownedByUs) {
      host.scheduler.binary(
        encodeEnvelope(ENVELOPE.OPEN, number, encodeAscii(id)),
        () => {
          this.#openHanded = true;
          if (this.hasNext) host.scheduler.addBulk(this);
        },
      );
    } else {
      this.#acceptTimer = host.clock.setTimer(ACCEPT_WAIT_MS, () => {
        this.#acceptTimer = undefined;
        this.#fail(new LinkChannelError("not-accepted"), "not-accepted");
      });
    }
  }

  get hasNext(): boolean {
    return this.#queue.length > 0;
  }

  get credit(): number {
    if (this.#failure !== undefined || this.#endQueued || this.#stoppedByPeer) return 0;
    return Math.max(0, this.#allowance - this.#handed - this.#queuedBytes);
  }

  markAccepted(): void {
    this.accepted = true;
    if (this.#acceptTimer !== undefined) {
      this.#host.clock.cancel(this.#acceptTimer);
      this.#acceptTimer = undefined;
    }
  }

  takeNext(): BulkMessage | undefined {
    const item = this.#queue.shift();
    if (item === undefined) return undefined;
    return {
      bytes: item.bytes,
      onHanded: () => {
        if (item.end) {
          this.#endHanded = true;
          this.#checkDone();
          return;
        }
        this.#queuedBytes -= item.payload;
        this.#handed += item.payload;
        this.#inFlight += 1;
        this.#updateStall();
      },
      onWritten: () => {
        if (item.end) return;
        this.#inFlight -= 1;
        this.#updateStall();
      },
    };
  }

  transportMoved(): void {
    this.#updateStall();
  }

  onData(payload: Uint8Array): void {
    if (this.#failure !== undefined) return;
    if (this.#inEnded) return this.#invalid("DATA after the direction ended");
    if (this.#stopSent) return;
    if (payload.length > MAX_DATA_BYTES) return this.#invalid("DATA over 64 KiB");
    if (this.#received + payload.length > CHANNEL_WINDOW + this.#granted) {
      return this.#invalid("DATA past the allowed bytes");
    }
    if (payload.length === 0) return;
    this.#received += payload.length;
    this.#inQueue.push(payload);
    this.#deliver();
  }

  onEnd(): void {
    if (this.#failure !== undefined) {
      // why: the peer's END still ends its direction after this side failed; the slot frees once both are done.
      this.#inEnded = true;
      this.#checkDone();
      return;
    }
    if (this.#inEnded) return this.#invalid("END after the direction ended");
    this.#inEnded = true;
    this.#deliver();
    this.#checkDone();
  }

  onStop(): void {
    if (this.#failure !== undefined) return;
    if (this.#stoppedByPeer) return this.#invalid("a second STOP for one direction");
    this.#dropQueuedData();
    if (this.#endQueued) return;
    this.#stoppedByPeer = true;
    this.#queueEnd();
    this.#failOutgoing(new LinkChannelError("stopped"));
  }

  onCredit(amount: number | undefined): void {
    if (this.#failure !== undefined) return;
    if (amount === undefined || amount < 1) return this.#invalid("a CREDIT of 0");
    const taken = this.#handed + this.#queuedBytes;
    if (this.#allowance + amount > taken + CHANNEL_WINDOW) {
      return this.#invalid("credit beyond 4 MiB outstanding");
    }
    this.#allowance += amount;
    this.#wakeWriters();
  }

  onReset(reason: ResetReason | undefined): void {
    this.#resetReceived = true;
    if (this.#failure === undefined) {
      this.#fail(
        new LinkChannelError(reason ?? "aborted"),
        this.#resetQueued ? undefined : "aborted",
      );
    }
    this.#checkDone();
  }

  closeWith(error: LinkChannelError): void {
    this.#resetQueued = true;
    this.#done = true;
    this.#fail(error, undefined);
  }

  abort(reason?: string): void {
    if (this.#failure !== undefined) return;
    this.#fail(new LinkChannelError("aborted", reason), "aborted");
  }

  #invalid(rule: string): void {
    this.#host.logger.warn(`link: channel ${this.id} broke a rule: ${rule}`);
    this.#fail(new LinkChannelError("invalid", rule), "invalid");
  }

  #fail(error: LinkChannelError, send: ResetReason | undefined): void {
    if (this.#failure !== undefined) return;
    this.#failure = error;
    this.#clearTimers();
    this.#host.scheduler.removeBulk(this);
    this.#queue = [];
    this.#queuedBytes = 0;
    this.#inQueue = [];
    this.#wantRead = false;
    this.#failOutgoing(error);
    try {
      this.#readableController?.error(error);
    } catch {
      // why: the readable may already be closed or cancelled, and a stream cannot be errored twice.
    }
    if (send !== undefined && !this.#resetQueued) {
      this.#resetQueued = true;
      this.#host.scheduler.binary(encodeReset(this.number, send), () => {
        this.#resetHanded = true;
        this.#checkDone();
      });
    }
    this.#checkDone();
  }

  #failOutgoing(error: LinkChannelError): void {
    this.#clearStall();
    const pending = this.#pendingWrite;
    this.#pendingWrite = undefined;
    pending?.reject(error);
    for (const waiter of this.#creditWaiters.splice(0)) waiter.reject(error);
    try {
      this.#writableController?.error(error);
    } catch {
      // why: the writable may already be closed or errored.
    }
  }

  #checkDone(): void {
    if (this.#done) return;
    const ours = this.#resetHanded || this.#endHanded;
    const theirs = this.#resetReceived || this.#inEnded;
    if (!ours || !theirs) return;
    this.#done = true;
    this.#clearTimers();
    this.#host.scheduler.removeBulk(this);
    this.#host.channelDone(this);
  }

  #clearTimers(): void {
    this.#clearStall();
    if (this.#acceptTimer !== undefined) {
      this.#host.clock.cancel(this.#acceptTimer);
      this.#acceptTimer = undefined;
    }
  }

  #dropQueuedData(): void {
    this.#queue = this.#queue.filter((item) => item.end);
    this.#queuedBytes = 0;
    if (this.#queue.length === 0) this.#host.scheduler.removeBulk(this);
  }

  #queueEnd(): void {
    this.#endQueued = true;
    this.#queue.push({ bytes: encodeEnvelope(ENVELOPE.END, this.number), end: true, payload: 0 });
    if (this.#openHanded) this.#host.scheduler.addBulk(this);
  }

  #take(chunk: Uint8Array): void {
    for (let offset = 0; offset < chunk.length; offset += MAX_DATA_BYTES) {
      const piece = chunk.subarray(offset, Math.min(chunk.length, offset + MAX_DATA_BYTES));
      this.#queue.push({
        bytes: encodeEnvelope(ENVELOPE.DATA, this.number, piece),
        end: false,
        payload: piece.length,
      });
      this.#queuedBytes += piece.length;
    }
    if (this.#openHanded) this.#host.scheduler.addBulk(this);
  }

  #wakeWriters(): void {
    const pending = this.#pendingWrite;
    this.#pendingWrite = undefined;
    pending?.resolve();
    for (const waiter of this.#creditWaiters.splice(0)) waiter.resolve();
    this.#updateStall();
  }

  #updateStall(): void {
    const waiting = this.#pendingWrite !== undefined || this.#creditWaiters.length > 0;
    const peerHoldsEverything =
      this.#queuedBytes === 0 && (this.#host.unsentBytes() === 0 || this.#inFlight === 0);
    if (!waiting || !peerHoldsEverything || this.#failure !== undefined) {
      this.#clearStall();
      return;
    }
    if (this.#stallTimer !== undefined) return;
    this.#stallTimer = this.#host.clock.setTimer(STALL_WAIT_MS, () => {
      this.#stallTimer = undefined;
      this.#fail(new LinkChannelError("stalled"), "stalled");
    });
  }

  #clearStall(): void {
    if (this.#stallTimer === undefined) return;
    this.#host.clock.cancel(this.#stallTimer);
    this.#stallTimer = undefined;
  }

  #deliver(): void {
    const controller = this.#readableController;
    if (controller === undefined || !this.#wantRead || this.#stopSent) return;
    const chunk = this.#inQueue.shift();
    if (chunk !== undefined) {
      this.#wantRead = false;
      this.#readTotal += chunk.length;
      controller.enqueue(chunk);
      this.#grant();
      return;
    }
    if (this.#inEnded) {
      this.#wantRead = false;
      controller.close();
    }
  }

  #grant(): void {
    const unread = this.#readTotal - this.#granted;
    if (unread <= 0 || this.#inEnded) return;
    if (unread < 64 * KIB && this.#inQueue.length > 0) return;
    this.#granted += unread;
    this.#host.scheduler.binary(encodeCredit(this.number, unread));
  }

  #cancelReadable(): void {
    if (this.#stopSent || this.#failure !== undefined) return;
    this.#inQueue = [];
    this.#wantRead = false;
    if (this.#inEnded) return;
    this.#stopSent = true;
    this.#host.scheduler.binary(encodeEnvelope(ENVELOPE.STOP, this.number));
  }

  #buildView(): LinkChannel {
    const readable = new LinkReadableStream<Uint8Array>(
      {
        start: (controller) => {
          this.#readableController = controller;
        },
        pull: () => {
          this.#wantRead = true;
          this.#deliver();
        },
        cancel: () => this.#cancelReadable(),
      },
      { highWaterMark: 0 },
    );
    const writable = new LinkWritableStream<Uint8Array>(
      {
        start: (controller) => {
          this.#writableController = controller;
        },
        write: (chunk) => this.#write(chunk),
        close: () => {
          if (this.#failure !== undefined) throw this.#failure;
          if (this.#endQueued) return;
          this.#queueEnd();
          const error = new LinkChannelError("closed", "the channel's sending direction ended");
          for (const waiter of this.#creditWaiters.splice(0)) waiter.reject(error);
          this.#updateStall();
        },
        abort: (reason) => {
          this.abort(reason === undefined ? undefined : String(reason));
        },
      },
      new LinkByteLengthQueuingStrategy({ highWaterMark: WRITER_BUFFER }),
    );
    const currentCredit = () => this.credit;
    return {
      abort: (reason) => this.abort(reason),
      get credit() {
        return currentCredit();
      },
      id: this.id,
      readable,
      whenCredit: () => this.#whenCredit(),
      writable,
    };
  }

  async #write(chunk: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.#failure !== undefined) throw this.#failure;
      if (this.#stoppedByPeer) throw new LinkChannelError("stopped");
      const n = Math.min(this.credit, chunk.length - offset);
      if (n > 0) {
        this.#take(chunk.subarray(offset, offset + n));
        offset += n;
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        this.#pendingWrite = { reject, resolve };
        this.#updateStall();
      });
    }
  }

  #whenCredit(): Promise<void> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    if (this.#stoppedByPeer) return Promise.reject(new LinkChannelError("stopped"));
    if (this.#endQueued) {
      return Promise.reject(
        new LinkChannelError("closed", "the channel's sending direction ended"),
      );
    }
    if (this.credit > 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.#creditWaiters.push({ reject, resolve });
      this.#updateStall();
    });
  }
}
