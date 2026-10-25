import type { UplinkTransportConnection } from "./ports.js";
import { KIB, utf8Length } from "./envelope.js";

const UNSENT_MARK = 256 * KIB;
const PRIORITY_SHARE = 64 * KIB;

export interface BulkMessage {
  readonly bytes: Uint8Array;
  onHanded(): void;
  onWritten(): void;
}

export interface BulkSource {
  takeNext(): BulkMessage | undefined;
  readonly hasNext: boolean;
}

type PriorityMessage =
  | { readonly kind: "text"; readonly text: string; readonly resolve: () => void }
  | { readonly kind: "binary"; readonly bytes: Uint8Array; readonly onHanded?: () => void };

export class Scheduler {
  readonly #transport: UplinkTransportConnection;
  readonly #priority: PriorityMessage[] = [];
  readonly #ring: BulkSource[] = [];
  readonly #inRing = new Set<BulkSource>();
  #prioritySinceBulk = 0;
  #pumping = false;
  #scheduled = false;
  #closed = false;

  constructor(transport: UplinkTransportConnection) {
    this.#transport = transport;
    transport.onSent(() => this.wake());
  }

  text(text: string): Promise<void> {
    if (this.#closed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#priority.push({ kind: "text", resolve, text });
      this.wake();
    });
  }

  binary(bytes: Uint8Array, onHanded?: () => void): void {
    if (this.#closed) return;
    this.#priority.push(
      onHanded === undefined ? { bytes, kind: "binary" } : { bytes, kind: "binary", onHanded },
    );
    this.wake();
  }

  addBulk(source: BulkSource): void {
    if (this.#inRing.has(source)) return;
    this.#inRing.add(source);
    this.#ring.push(source);
    this.wake();
  }

  removeBulk(source: BulkSource): void {
    if (!this.#inRing.delete(source)) return;
    this.#ring.splice(this.#ring.indexOf(source), 1);
  }

  wake(): void {
    if (this.#scheduled || this.#closed) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#pump();
    });
  }

  close(): void {
    this.#closed = true;
    for (const message of this.#priority.splice(0)) {
      if (message.kind === "text") message.resolve();
    }
    this.#ring.length = 0;
    this.#inRing.clear();
  }

  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (!this.#closed) {
        const canBulk = this.#ring.length > 0 && this.#transport.unsentBytes < UNSENT_MARK;
        const bulkDue = canBulk && this.#prioritySinceBulk >= PRIORITY_SHARE;
        if (this.#priority.length > 0 && !bulkDue) {
          this.#sendPriority();
        } else if (canBulk) {
          this.#sendBulk();
        } else {
          break;
        }
      }
    } finally {
      this.#pumping = false;
    }
  }

  #sendPriority(): void {
    const message = this.#priority.shift();
    if (message === undefined) return;
    if (message.kind === "text") {
      this.#prioritySinceBulk += utf8Length(message.text);
      const done = () => message.resolve();
      this.#transport.write(message.text).then(done, done);
      return;
    }
    this.#prioritySinceBulk += message.bytes.length;
    message.onHanded?.();
    this.#transport.writeBinary(message.bytes).catch(() => undefined);
  }

  #sendBulk(): void {
    const source = this.#ring.shift();
    if (source === undefined) return;
    const message = source.takeNext();
    if (source.hasNext) {
      this.#ring.push(source);
    } else {
      this.#inRing.delete(source);
    }
    if (message === undefined) return;
    this.#prioritySinceBulk = 0;
    message.onHanded();
    const written = () => message.onWritten();
    this.#transport.writeBinary(message.bytes).then(written, written);
  }
}
