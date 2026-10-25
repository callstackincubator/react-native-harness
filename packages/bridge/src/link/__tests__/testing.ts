import { createHash } from "node:crypto";

import {
  createConnectionPair,
  FakeClock,
  type Logger,
  type MemoryTransportConnection,
  type UplinkTransportConnection,
} from "./ports.js";
import { createLink, type LinkChannel, type LinkConnection } from "../index.js";

export const KiB = 1024;
export const MiB = 1024 * KiB;

export const TYPE = { OPEN: 1, DATA: 2, END: 3, STOP: 4, CREDIT: 5, RESET: 6 } as const;
export const RESET_CODE = { aborted: 1, stalled: 2, "not-accepted": 3, invalid: 4 } as const;

export interface Envelope {
  readonly type: number;
  readonly number: number;
  readonly payload: Uint8Array;
}

export function envelope(type: number, number: number, payload = new Uint8Array(0)): Uint8Array {
  const bytes = new Uint8Array(5 + payload.length);
  bytes[0] = type;
  new DataView(bytes.buffer).setUint32(1, number);
  bytes.set(payload, 5);
  return bytes;
}

function parseEnvelope(bytes: Uint8Array): Envelope {
  return {
    type: bytes[0] ?? -1,
    number: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1),
    payload: bytes.slice(5),
  };
}

export function openEnvelope(number: number, id: string): Uint8Array {
  return envelope(TYPE.OPEN, number, new TextEncoder().encode(id));
}

export function dataEnvelope(number: number, size: number): Uint8Array {
  return envelope(TYPE.DATA, number, new Uint8Array(size).fill(7));
}

export function creditEnvelope(number: number, amount: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, amount);
  return envelope(TYPE.CREDIT, number, payload);
}

export function resetEnvelope(number: number, reason: keyof typeof RESET_CODE): Uint8Array {
  return envelope(TYPE.RESET, number, new Uint8Array([RESET_CODE[reason]]));
}

export type Sent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly size: number; readonly envelope: Envelope };

export class TappedTransport implements UplinkTransportConnection {
  readonly sent: Sent[] = [];
  readonly #sentListeners = new Set<() => void>();
  #extraUnsent = 0;

  constructor(readonly inner: UplinkTransportConnection) {
    inner.onSent(() => this.fireSent());
  }

  get closed(): boolean {
    return this.inner.closed;
  }

  get unsentBytes(): number {
    return this.inner.unsentBytes + this.#extraUnsent;
  }

  setUnsent(bytes: number): void {
    this.#extraUnsent = bytes;
  }

  fireSent(): void {
    for (const listener of this.#sentListeners) listener();
  }

  onData(listener: (chunk: string) => void): () => void {
    return this.inner.onData(listener);
  }

  onClose(listener: () => void): () => void {
    return this.inner.onClose(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    return this.inner.onError(listener);
  }

  onBinary(listener: (bytes: Uint8Array) => void): () => void {
    return this.inner.onBinary(listener);
  }

  onSent(listener: () => void): () => void {
    this.#sentListeners.add(listener);
    return () => this.#sentListeners.delete(listener);
  }

  write(contents: string): Promise<void> {
    this.sent.push({ kind: "text", text: contents });
    return this.inner.write(contents);
  }

  writeBinary(bytes: Uint8Array): Promise<void> {
    this.sent.push({ kind: "binary", size: bytes.length, envelope: parseEnvelope(bytes) });
    return this.inner.writeBinary(bytes);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  binaries(type?: number): Envelope[] {
    const out: Envelope[] = [];
    for (const entry of this.sent) {
      if (entry.kind === "binary" && (type === undefined || entry.envelope.type === type)) {
        out.push(entry.envelope);
      }
    }
    return out;
  }
}

export class RecordingLogger implements Logger {
  readonly records: { readonly level: string; readonly message: string }[] = [];
  debug(message: string): void {
    this.records.push({ level: "debug", message });
  }
  info(message: string): void {
    this.records.push({ level: "info", message });
  }
  warn(message: string): void {
    this.records.push({ level: "warn", message });
  }
  error(message: string): void {
    this.records.push({ level: "error", message });
  }
  child(): Logger {
    return this;
  }
  problems(): string[] {
    return this.records
      .filter((record) => record.level === "warn" || record.level === "error")
      .map((record) => record.message);
  }
}

export type Outcome<T> =
  | { readonly state: "resolved"; readonly value: T }
  | { readonly state: "rejected"; readonly error: unknown }
  | { readonly state: "pending" };

export async function outcome<T>(promise: Promise<T>, ms = 2000): Promise<Outcome<T>> {
  let timer: NodeJS.Timeout | undefined;
  const pending = new Promise<Outcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ state: "pending" }), ms);
  });
  try {
    return await Promise.race([
      promise.then(
        (value): Outcome<T> => ({ state: "resolved", value }),
        (error: unknown): Outcome<T> => ({ state: "rejected", error }),
      ),
      pending,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

export interface LinkPair {
  readonly clock: FakeClock;
  readonly worker: LinkConnection;
  readonly gateway: LinkConnection;
  readonly workerTap: TappedTransport;
  readonly gatewayTap: TappedTransport;
  readonly workerEnd: MemoryTransportConnection;
  readonly gatewayEnd: MemoryTransportConnection;
  readonly workerLog: RecordingLogger;
  readonly gatewayLog: RecordingLogger;
}

export function linkPair(options: { gatewayFirstNumber?: number } = {}): LinkPair {
  const clock = new FakeClock(0);
  const [workerEnd, gatewayEnd] = createConnectionPair();
  const workerTap = new TappedTransport(workerEnd);
  const gatewayTap = new TappedTransport(gatewayEnd);
  const workerLog = new RecordingLogger();
  const gatewayLog = new RecordingLogger();
  const worker = createLink(workerTap, { clock, end: "worker", logger: workerLog });
  const gateway = createLink(gatewayTap, {
    clock,
    end: "gateway",
    logger: gatewayLog,
    ...(options.gatewayFirstNumber === undefined
      ? {}
      : { firstChannelNumber: options.gatewayFirstNumber }),
  });
  return {
    clock,
    gateway,
    gatewayEnd,
    gatewayLog,
    gatewayTap,
    worker,
    workerEnd,
    workerLog,
    workerTap,
  };
}

export interface RawPeer {
  readonly clock: FakeClock;
  readonly link: LinkConnection;
  readonly tap: TappedTransport;
  readonly raw: MemoryTransportConnection;
  readonly log: RecordingLogger;
  readonly received: Envelope[];
  readonly receivedText: string[];
  readonly linkText: string[];
}

export function linkWithRawPeer(): RawPeer {
  const clock = new FakeClock(0);
  const [linkEnd, raw] = createConnectionPair();
  const tap = new TappedTransport(linkEnd);
  const log = new RecordingLogger();
  const link = createLink(tap, { clock, end: "worker", logger: log });
  const received: Envelope[] = [];
  const receivedText: string[] = [];
  const linkText: string[] = [];
  raw.onBinary((bytes) => received.push(parseEnvelope(bytes)));
  raw.onData((chunk) => receivedText.push(chunk));
  link.onData((chunk) => linkText.push(chunk));
  return { clock, link, log, linkText, raw, received, receivedText, tap };
}

export function pattern(offset: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (offset + i) % 251;
  return bytes;
}

export function patternHash(total: number): string {
  const hash = createHash("sha256");
  for (let offset = 0; offset < total; offset += MiB) {
    hash.update(pattern(offset, Math.min(MiB, total - offset)));
  }
  return hash.digest("hex");
}

export async function pump(
  writable: WritableStream<Uint8Array>,
  total: number,
  chunk = 64 * KiB,
): Promise<void> {
  const writer = writable.getWriter();
  for (let offset = 0; offset < total; offset += chunk) {
    await writer.write(pattern(offset, Math.min(chunk, total - offset)));
  }
  await writer.close();
}

export async function drain(
  readable: ReadableStream<Uint8Array>,
): Promise<{ length: number; hash: string }> {
  const reader = readable.getReader();
  const hash = createHash("sha256");
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    length += value.length;
  }
  return { hash: hash.digest("hex"), length };
}

export async function readAll(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return new Uint8Array(Buffer.concat(parts));
}

export async function writeAndClose(channel: LinkChannel, bytes: Uint8Array): Promise<void> {
  const writer = channel.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
}

export async function writeUntilBlocked(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  chunk = 64 * KiB,
  limit = 400,
): Promise<number> {
  let accepted = 0;
  for (let i = 0; i < limit; i += 1) {
    const ready = await Promise.race([
      writer.ready.then(
        () => true,
        () => false,
      ),
      settle().then(() => false),
    ]);
    if (!ready) break;
    writer.write(pattern(accepted, chunk)).catch(() => undefined);
    accepted += chunk;
  }
  return accepted;
}

export async function endChannel(a: LinkChannel, b: LinkChannel): Promise<void> {
  await Promise.all([
    a.writable.getWriter().close(),
    b.writable.getWriter().close(),
    drain(a.readable),
    drain(b.readable),
  ]);
}

export async function errorOfRead(readable: ReadableStream<Uint8Array>): Promise<unknown> {
  const reader = readable.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) throw new Error("the readable ended cleanly instead of erroring");
    }
  } catch (error: unknown) {
    return error;
  }
}

export async function errorOfWritable(writable: WritableStream<Uint8Array>): Promise<unknown> {
  const writer = writable.getWriter();
  try {
    await writer.closed;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("the writable closed cleanly instead of erroring");
}

export function signal(): AbortSignal {
  return new AbortController().signal;
}
