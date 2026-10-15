// Test doubles from simlock's `src/ports` that the link's tests use: `FakeClock` and the
// in-memory connection pair.
import { utf8Length } from "../envelope.js";
import type { Clock, TimerHandle, UplinkTransportConnection } from "../ports.js";

export type { Logger, UplinkTransportConnection } from "../ports.js";

interface ScheduledTimer {
  readonly deadline: number;
  readonly id: number;
  readonly callback: () => void;
}

export class FakeClock implements Clock {
  #now: number;
  #nextTimerId = 0;
  readonly #timers = new Map<number, ScheduledTimer>();

  constructor(initialNow = 0) {
    this.#now = initialNow;
  }

  now(): number {
    return this.#now;
  }

  get pendingTimerCount(): number {
    return this.#timers.size;
  }

  setTimer(delayMs: number, callback: () => void): TimerHandle {
    const id = this.#nextTimerId;
    this.#nextTimerId += 1;
    this.#timers.set(id, {
      deadline: this.#now + Math.max(0, delayMs),
      id,
      callback,
    });

    return { id } as TimerHandle & { readonly id: number };
  }

  cancel(handle: TimerHandle): void {
    const timer = handle as TimerHandle & { readonly id: number };
    this.#timers.delete(timer.id);
  }

  advance(milliseconds: number): void {
    const target = this.#now + milliseconds;
    let nextTimer = this.#nextTimerDueBy(target);

    while (nextTimer !== undefined) {
      this.#timers.delete(nextTimer.id);
      this.#now = nextTimer.deadline;
      nextTimer.callback();
      nextTimer = this.#nextTimerDueBy(target);
    }

    this.#now = target;
  }

  #nextTimerDueBy(target: number): ScheduledTimer | undefined {
    let selected: ScheduledTimer | undefined;

    for (const timer of this.#timers.values()) {
      if (
        timer.deadline <= target &&
        (selected === undefined ||
          timer.deadline < selected.deadline ||
          (timer.deadline === selected.deadline && timer.id < selected.id))
      ) {
        selected = timer;
      }
    }

    return selected;
  }
}

export interface MemoryTransportConnection extends UplinkTransportConnection {
  hold(): void;
  release(): void;
  fail(error: Error): void;
}

function subscribeListener<Listener>(listeners: Set<Listener>, listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Two connections wired to each other: what one writes, the other's listeners receive;
 * closing either closes both. `hold()` keeps writes as unsent until `release()`.
 */
export function createConnectionPair(): [MemoryTransportConnection, MemoryTransportConnection] {
  const left = new PairedConnection();
  const right = new PairedConnection();
  left.pair(right);
  right.pair(left);
  return [left, right];
}

type PairedMessage =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly bytes: Uint8Array };

class PairedConnection implements MemoryTransportConnection {
  readonly #closeListeners = new Set<() => void>();
  readonly #dataListeners = new Set<(chunk: string) => void>();
  readonly #pending: string[] = [];
  readonly #errorListeners = new Set<(error: Error) => void>();
  readonly #binaryListeners = new Set<(bytes: Uint8Array) => void>();
  readonly #sentListeners = new Set<() => void>();
  readonly #queue: Array<{ message: PairedMessage; resolve: () => void; size: number }> = [];
  #unsent = 0;
  #held = false;
  #peer: PairedConnection | undefined;
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  pair(peer: PairedConnection): void {
    this.#peer = peer;
  }

  onData(listener: (chunk: string) => void): () => void {
    const unsubscribe = subscribeListener(this.#dataListeners, listener);
    if (this.#pending.length > 0) {
      const buffered = this.#pending.splice(0);
      for (const chunk of buffered) listener(chunk);
    }
    return unsubscribe;
  }

  onClose(listener: () => void): () => void {
    if (this.#closed) {
      listener();
      return () => undefined;
    }
    return subscribeListener(this.#closeListeners, listener);
  }

  onError(listener: (error: Error) => void): () => void {
    return subscribeListener(this.#errorListeners, listener);
  }

  get unsentBytes(): number {
    return this.#unsent;
  }

  onBinary(listener: (bytes: Uint8Array) => void): () => void {
    return subscribeListener(this.#binaryListeners, listener);
  }

  onSent(listener: () => void): () => void {
    return subscribeListener(this.#sentListeners, listener);
  }

  hold(): void {
    this.#held = true;
  }

  release(): void {
    this.#held = false;
    while (this.#queue.length > 0) {
      const entry = this.#queue.shift();
      if (entry === undefined) break;
      this.#unsent -= entry.size;
      this.#deliver(entry.message);
      entry.resolve();
    }
    this.#unsent = 0;
    for (const listener of this.#sentListeners) listener();
  }

  fail(error: Error): void {
    for (const listener of this.#errorListeners) listener(error);
    void this.close();
  }

  async write(contents: string): Promise<void> {
    await this.#send({ kind: "text", text: contents }, utf8Length(contents));
  }

  async writeBinary(bytes: Uint8Array): Promise<void> {
    await this.#send({ kind: "binary", bytes }, bytes.length);
  }

  async #send(message: PairedMessage, size: number): Promise<void> {
    if (this.#closed) return;
    if (!this.#held) {
      this.#deliver(message);
      return;
    }
    this.#unsent += size;
    await new Promise<void>((resolve) => {
      this.#queue.push({ message, resolve, size });
    });
  }

  #deliver(message: PairedMessage): void {
    const peer = this.#peer;
    if (this.#closed || peer === undefined || peer.#closed) return;
    if (message.kind === "binary") {
      for (const listener of peer.#binaryListeners) listener(message.bytes);
      return;
    }
    if (peer.#dataListeners.size === 0) {
      peer.#pending.push(message.text);
      return;
    }
    for (const listener of peer.#dataListeners) listener(message.text);
  }

  async close(): Promise<void> {
    this.#close();
    const peer = this.#peer;
    if (peer !== undefined) peer.#close();
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsent = 0;
    for (const entry of this.#queue.splice(0)) entry.resolve();
    for (const listener of this.#closeListeners) listener();
  }
}
