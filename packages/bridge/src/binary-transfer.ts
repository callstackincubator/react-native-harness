export const HEADER_SIZE = 8;

export function createBinaryFrame(
  transferId: number,
  data: Uint8Array
): Uint8Array {
  const frame = new Uint8Array(HEADER_SIZE + data.length);
  const view = new DataView(frame.buffer);

  // Transfer ID (4 bytes, Big Endian)
  view.setUint32(0, transferId, false);

  // Reserved (4 bytes) - set to 0
  view.setUint32(4, 0, false);

  // Copy data
  frame.set(data, HEADER_SIZE);

  return frame;
}

export function parseBinaryFrame(frame: Uint8Array): {
  transferId: number;
  data: Uint8Array;
} {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const transferId = view.getUint32(0, false);
  const data = frame.subarray(HEADER_SIZE);

  return { transferId, data };
}

export class BinaryStore {
  private store = new Map<number, Uint8Array>();
  private timeouts = new Map<number, any>();
  // 5 minutes timeout for binary data
  private readonly TIMEOUT_MS = 5 * 60 * 1000;

  add(transferId: number, data: Uint8Array): void {
    this.store.set(transferId, data);
    const timeout = setTimeout(() => {
      this.store.delete(transferId);
      this.timeouts.delete(transferId);
    }, this.TIMEOUT_MS);
    this.timeouts.set(transferId, timeout);
  }

  get(transferId: number): Uint8Array | undefined {
    return this.store.get(transferId);
  }

  delete(transferId: number): boolean {
    const timeout = this.timeouts.get(transferId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(transferId);
    }
    return this.store.delete(transferId);
  }

  dispose(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.store.clear();
  }
}

let nextTransferId = 1;
export function generateTransferId(): number {
  // Use a rolling counter, but ensure it doesn't overflow 32-bit integer just in case
  // though JS numbers are doubles, we are writing to Uint32.
  const id = nextTransferId++;
  if (nextTransferId > 0xffffffff) {
    nextTransferId = 1;
  }
  return id;
}
