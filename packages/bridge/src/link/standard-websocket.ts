import { globalClock, type Clock, type TimerHandle, type UplinkTransportConnection } from "./ports.js";

export { globalClock } from "./ports.js";

export interface StandardWebSocket {
  binaryType: string;
  // harness: React Native declares bufferedAmount but never sets it.
  readonly bufferedAmount: number | undefined;
  readonly readyState: number;
  send(data: string | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: never): void;
  removeEventListener(type: "open" | "close" | "error" | "message", listener: never): void;
}

const OPEN = 1;

export interface StandardWebSocketOptions {
  readonly clock?: Clock;
  readonly pollMs?: number;
}

const DEFAULT_POLL_MS = 4;

interface MessageLike {
  readonly data: unknown;
}

interface Waiter {
  readonly target: number;
  readonly resolve: () => void;
}

export class StandardWebSocketConnection implements UplinkTransportConnection {
  readonly #socket: StandardWebSocket;
  readonly #clock: Clock;
  readonly #pollMs: number;
  readonly #dataListeners = new Set<(chunk: string) => void>();
  readonly #binaryListeners = new Set<(bytes: Uint8Array) => void>();
  readonly #closeListeners = new Set<() => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();
  readonly #sentListeners = new Set<() => void>();
  readonly #pending: string[] = [];
  #waiters: Waiter[] = [];
  #queued = 0;
  #flushed = 0;
  #checkScheduled = false;
  #timer: TimerHandle | undefined;
  #closed = false;

  constructor(socket: StandardWebSocket, options: StandardWebSocketOptions = {}) {
    this.#socket = socket;
    this.#clock = options.clock ?? globalClock;
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    // why: the default, "blob", cannot be read without awaiting, which would reorder messages.
    socket.binaryType = "arraybuffer";
    const onMessage = (event: MessageLike) => {
      this.#onMessage(event.data);
    };
    const onClose = () => this.#markClosed();
    const onError = (event: { readonly error?: unknown }) => {
      const error = event.error instanceof Error ? event.error : new Error("WebSocket error");
      for (const listener of this.#errorListeners) listener(error);
      this.#markClosed();
    };
    socket.addEventListener("message", onMessage as never);
    socket.addEventListener("close", onClose as never);
    socket.addEventListener("error", onError as never);
  }

  get closed(): boolean {
    return this.#closed;
  }

  get #buffered(): number {
    return this.#socket.bufferedAmount ?? 0;
  }

  get unsentBytes(): number {
    return this.#buffered;
  }

  onData(listener: (chunk: string) => void): () => void {
    this.#dataListeners.add(listener);
    if (this.#pending.length > 0) {
      for (const chunk of this.#pending.splice(0)) listener(chunk);
    }
    return () => {
      this.#dataListeners.delete(listener);
    };
  }

  onBinary(listener: (bytes: Uint8Array) => void): () => void {
    this.#binaryListeners.add(listener);
    return () => {
      this.#binaryListeners.delete(listener);
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

  onSent(listener: () => void): () => void {
    this.#sentListeners.add(listener);
    return () => {
      this.#sentListeners.delete(listener);
    };
  }

  write(contents: string): Promise<void> {
    return this.#send(contents);
  }

  writeBinary(bytes: Uint8Array): Promise<void> {
    return this.#send(bytes);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#socket.close();
    this.#markClosed();
  }

  #send(data: string | Uint8Array): Promise<void> {
    if (this.#closed || this.#socket.readyState !== OPEN) return Promise.resolve();
    // why: the standard send() has no completion callback, so what has left the buffer is worked out from bufferedAmount.
    const before = this.#buffered;
    this.#socket.send(data);
    this.#queued += Math.max(0, this.#buffered - before);
    return new Promise<void>((resolve) => {
      this.#waiters.push({ resolve, target: this.#queued });
      this.#scheduleCheck();
    });
  }

  #onMessage(data: unknown): void {
    if (typeof data === "string") {
      if (this.#dataListeners.size === 0) {
        this.#pending.push(data);
      } else {
        for (const listener of this.#dataListeners) listener(data);
      }
    } else if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      for (const listener of this.#binaryListeners) listener(bytes);
    } else if (ArrayBuffer.isView(data)) {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      for (const listener of this.#binaryListeners) listener(bytes);
    }
    // why: a peer's message, a credit most of all, says bytes are moving, and is a cheaper look than a timer.
    if (this.#waiters.length > 0 || this.#flushed < this.#queued) this.#check();
  }

  #scheduleCheck(): void {
    if (this.#checkScheduled) return;
    // why: a write must not settle, or report sent, before the call that made it has returned.
    this.#checkScheduled = true;
    void Promise.resolve().then(() => {
      this.#checkScheduled = false;
      this.#check();
    });
  }

  #check(): void {
    if (this.#closed) return;
    const buffered = this.#buffered;
    const flushed = Math.max(this.#flushed, this.#queued - buffered);
    const moved = flushed > this.#flushed;
    this.#flushed = flushed;
    if (this.#waiters.some((waiter) => waiter.target <= flushed)) {
      const due = this.#waiters.filter((waiter) => waiter.target <= flushed);
      this.#waiters = this.#waiters.filter((waiter) => waiter.target > flushed);
      for (const waiter of due) waiter.resolve();
    }
    if (moved) for (const listener of this.#sentListeners) listener();
    if (buffered === 0 && this.#timer !== undefined) {
      this.#clock.cancel(this.#timer);
      this.#timer = undefined;
    }
    // why: a background tab throttles timers to about one a second, so a large transfer there slows until the tab is shown again.
    if (buffered > 0 && this.#timer === undefined) {
      this.#timer = this.#clock.setTimer(this.#pollMs, () => {
        this.#timer = undefined;
        this.#check();
      });
    }
  }

  #markClosed(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== undefined) {
      this.#clock.cancel(this.#timer);
      this.#timer = undefined;
    }
    for (const waiter of this.#waiters.splice(0)) waiter.resolve();
    for (const listener of this.#closeListeners) listener();
  }
}

export interface StandardWebSocketDialOptions extends StandardWebSocketOptions {
  readonly url: string;
  readonly protocols?: string | string[];
  readonly createSocket?: (url: string, protocols?: string | string[]) => StandardWebSocket;
}

export async function connectStandardWebSocket(
  options: StandardWebSocketDialOptions,
): Promise<UplinkTransportConnection> {
  const create =
    options.createSocket ??
    ((url: string, protocols?: string | string[]) =>
      new WebSocket(url, protocols) as unknown as StandardWebSocket);
  const socket = create(options.url, options.protocols);
  const connection = new StandardWebSocketConnection(socket, options);
  await new Promise<void>((resolve, reject) => {
    if (socket.readyState === OPEN) return resolve();
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onFail = () => {
      cleanup();
      reject(new Error(`could not open a WebSocket to ${options.url}`));
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen as never);
      socket.removeEventListener("error", onFail as never);
      socket.removeEventListener("close", onFail as never);
    };
    socket.addEventListener("open", onOpen as never);
    socket.addEventListener("error", onFail as never);
    socket.addEventListener("close", onFail as never);
  });
  return connection;
}
