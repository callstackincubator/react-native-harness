import type { Clock, IpcConnection, Logger, UplinkTransportConnection } from "./ports.js";
import { Channel, LinkChannelError, type ChannelHost, type LinkChannel } from "./channel.js";
import {
  ENVELOPE,
  MAX_CHANNEL_NUMBER,
  isChannelId,
  isEnvelopeType,
  parseChannelId,
  parseCredit,
  parseEnvelope,
  parseResetReason,
  type ParsedEnvelope,
} from "./envelope.js";
import { Scheduler } from "./scheduler.js";

export { LinkChannelError } from "./channel.js";
export type { LinkChannel, LinkChannelErrorReason } from "./channel.js";
export { globalClock } from "./ports.js";
export type {
  Clock,
  IpcConnection,
  Logger,
  TimerHandle,
  UplinkTransportConnection,
} from "./ports.js";
export {
  connectStandardWebSocket,
  StandardWebSocketConnection,
  type StandardWebSocket,
  type StandardWebSocketDialOptions,
  type StandardWebSocketOptions,
} from "./standard-websocket.js";

export interface LinkConnection extends IpcConnection {
  openChannel(options: { readonly signal: AbortSignal }): Promise<LinkChannel>;
  acceptChannel(id: string): LinkChannel;
}

export interface LinkOptions {
  readonly end: "worker" | "gateway";
  readonly clock: Clock;
  readonly logger: Logger;
  readonly firstChannelNumber?: number;
  readonly generateId?: () => string;
}

const OPEN_LIMIT = 64;

interface OpenWaiter {
  readonly resolve: (channel: LinkChannel) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

class Link implements LinkConnection, ChannelHost {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly scheduler: Scheduler;
  readonly #transport: UplinkTransportConnection;
  readonly #ownParity: number;
  readonly #generateId: () => string;
  readonly #channels = new Map<number, Channel>();
  readonly #unaccepted = new Map<string, Channel>();
  readonly #waiters: OpenWaiter[] = [];
  readonly #dataListeners = new Set<(chunk: string) => void>();
  readonly #closeListeners = new Set<() => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();
  readonly #pendingText: string[] = [];
  #nextOwn: number;
  #highestPeer = 0;
  #ownOpen = 0;
  #peerOpen = 0;
  #closed = false;

  constructor(transport: UplinkTransportConnection, options: LinkOptions) {
    this.clock = options.clock;
    this.logger = options.logger;
    this.#transport = transport;
    this.#ownParity = options.end === "worker" ? 1 : 0;
    this.#generateId = options.generateId ?? randomId;
    this.#nextOwn = options.firstChannelNumber ?? (options.end === "worker" ? 1 : 2);
    this.scheduler = new Scheduler(transport);
    transport.onData((chunk) => this.#onText(chunk));
    transport.onBinary((bytes) => this.#onBinary(bytes));
    transport.onError((error) => {
      for (const listener of this.#errorListeners) listener(error);
    });
    transport.onSent(() => {
      for (const channel of this.#channels.values()) channel.transportMoved();
    });
    transport.onClose(() => this.#onTransportClosed());
  }

  get closed(): boolean {
    return this.#closed || this.#transport.closed;
  }

  unsentBytes(): number {
    return this.#transport.unsentBytes;
  }

  onData(listener: (chunk: string) => void): () => void {
    this.#dataListeners.add(listener);
    if (this.#pendingText.length > 0) {
      for (const chunk of this.#pendingText.splice(0)) listener(chunk);
    }
    return () => {
      this.#dataListeners.delete(listener);
    };
  }

  onClose(listener: () => void): () => void {
    if (this.#closed) {
      listener();
      return () => undefined;
    }
    this.#closeListeners.add(listener);
    return () => {
      this.#closeListeners.delete(listener);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this.#errorListeners.add(listener);
    return () => {
      this.#errorListeners.delete(listener);
    };
  }

  write(contents: string): Promise<void> {
    return this.scheduler.text(contents);
  }

  async close(): Promise<void> {
    await this.#transport.close();
    this.#onTransportClosed();
  }

  openChannel(options: { readonly signal: AbortSignal }): Promise<LinkChannel> {
    const { signal } = options;
    if (this.#closed) return Promise.reject(new LinkChannelError("closed"));
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this.#ownOpen < OPEN_LIMIT && this.#waiters.length === 0) {
      try {
        return Promise.resolve(this.#open().view);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    }
    return new Promise<LinkChannel>((resolve, reject) => {
      const onAbort = () => {
        const at = this.#waiters.findIndex((waiter) => waiter.onAbort === onAbort);
        if (at >= 0) this.#waiters.splice(at, 1);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push({ onAbort, reject, resolve, signal });
    });
  }

  acceptChannel(id: string): LinkChannel {
    const channel = this.#unaccepted.get(id);
    if (channel === undefined) {
      throw new Error(`channel ${id} was not opened by the peer, or was already accepted or ended`);
    }
    this.#unaccepted.delete(id);
    channel.markAccepted();
    return channel.view;
  }

  channelDone(channel: Channel): void {
    if (this.#channels.get(channel.number) !== channel) return;
    this.#forget(channel);
    this.#drainWaiters();
  }

  #forget(channel: Channel): void {
    this.#channels.delete(channel.number);
    if (this.#unaccepted.get(channel.id) === channel) this.#unaccepted.delete(channel.id);
    if (channel.ownedByUs) this.#ownOpen -= 1;
    else this.#peerOpen -= 1;
  }

  #open(): Channel {
    if (this.#nextOwn > MAX_CHANNEL_NUMBER) {
      this.logger.warn("link: this side has used every channel number on the connection");
      throw new Error("the link has no channel numbers left on this connection");
    }
    let id = this.#newId();
    while (this.#channels.size > 0 && [...this.#channels.values()].some((c) => c.id === id)) {
      id = this.#newId();
    }
    const number = this.#nextOwn;
    this.#nextOwn += 2;
    const channel = new Channel(this, number, id, true);
    this.#channels.set(number, channel);
    this.#ownOpen += 1;
    return channel;
  }

  #newId(): string {
    const id = this.#generateId();
    if (!isChannelId(id)) {
      throw new Error("link: `generateId` must make ids of 1 to 32 characters from [A-Za-z0-9-]");
    }
    return id;
  }

  #drainWaiters(): void {
    while (this.#waiters.length > 0 && this.#ownOpen < OPEN_LIMIT && !this.#closed) {
      const waiter = this.#waiters.shift();
      if (waiter === undefined) break;
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      try {
        waiter.resolve(this.#open().view);
      } catch (error: unknown) {
        waiter.reject(error);
      }
    }
  }

  #onText(chunk: string): void {
    if (this.#dataListeners.size === 0) {
      this.#pendingText.push(chunk);
      return;
    }
    for (const listener of this.#dataListeners) listener(chunk);
  }

  #onTransportClosed(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.scheduler.close();
    for (const waiter of this.#waiters.splice(0)) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(new LinkChannelError("closed"));
    }
    const error = new LinkChannelError("closed");
    for (const channel of this.#channels.values()) channel.closeWith(error);
    this.#channels.clear();
    this.#unaccepted.clear();
    for (const listener of this.#closeListeners) listener();
  }

  #warn(rule: string): void {
    this.logger.warn(`link: dropped a message from the peer: ${rule}`);
  }

  #onBinary(bytes: Uint8Array): void {
    const envelope = parseEnvelope(bytes);
    if (envelope === undefined) return this.#warn("a message too short to read");
    if (!isEnvelopeType(envelope.type)) return this.#warn("an unknown envelope type");
    if (envelope.type === ENVELOPE.OPEN) return this.#onOpen(envelope.number, envelope.payload);
    const channel = this.#channels.get(envelope.number);
    if (channel === undefined) {
      if (!this.#isLate(envelope.number)) this.#warn("a channel number the peer never opened");
      return;
    }
    this.#dispatch(channel, envelope);
  }

  #dispatch(channel: Channel, envelope: ParsedEnvelope): void {
    switch (envelope.type) {
      case ENVELOPE.DATA:
        return channel.onData(envelope.payload);
      case ENVELOPE.END:
        return channel.onEnd();
      case ENVELOPE.STOP:
        return channel.onStop();
      case ENVELOPE.CREDIT:
        return channel.onCredit(parseCredit(envelope.payload));
      case ENVELOPE.RESET:
        return channel.onReset(parseResetReason(envelope.payload));
    }
  }

  #isLate(number: number): boolean {
    if (number < 1) return false;
    if (number % 2 === this.#ownParity) return number < this.#nextOwn;
    return number <= this.#highestPeer;
  }

  #onOpen(number: number, payload: Uint8Array): void {
    if (number % 2 === this.#ownParity || number < 1)
      return this.#warn("an OPEN with the wrong parity");
    if (number <= this.#highestPeer) {
      return this.#warn(
        this.#channels.has(number)
          ? "an OPEN reusing a live number"
          : "an OPEN reusing an ended number",
      );
    }
    if (this.#peerOpen >= OPEN_LIMIT) return this.#warn("a 65th OPEN from the peer");
    const id = parseChannelId(payload);
    if (id === undefined) return this.#warn("an OPEN with an id outside [A-Za-z0-9-]{1,32}");
    if (this.#unaccepted.has(id)) return this.#warn("an OPEN reusing an id not yet accepted");
    this.#highestPeer = number;
    const channel = new Channel(this, number, id, false);
    this.#channels.set(number, channel);
    this.#unaccepted.set(id, channel);
    this.#peerOpen += 1;
  }
}

function randomId(): string {
  const source = globalThis.crypto as Crypto | undefined;
  if (typeof source?.randomUUID === "function") return source.randomUUID().replace(/-/g, "");
  if (typeof source?.getRandomValues === "function") {
    const bytes = source.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("link: this runtime has no crypto to make channel ids; pass `generateId`");
}

export function createLink(
  transport: UplinkTransportConnection,
  options: LinkOptions,
): LinkConnection {
  return new Link(transport, options);
}
