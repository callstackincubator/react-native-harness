// The parts of simlock's `src/ports` the link uses. Types only, plus `globalClock`,
// so the link runs unchanged in Node, a browser, and React Native.

export interface TimerHandle {
  readonly _timerHandle?: never;
}

export interface Clock {
  now(): number;
  setTimer(delayMs: number, callback: () => void): TimerHandle;
  cancel(handle: TimerHandle): void;
}

export const globalClock: Clock = {
  cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  setTimer: (delayMs, callback) => setTimeout(callback, delayMs) as unknown as TimerHandle,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(module: string): Logger;
}

export interface IpcConnection {
  readonly closed: boolean;
  onData(listener: (chunk: string) => void): () => void;
  onClose(listener: () => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  write(contents: string): Promise<void>;
  close(): Promise<void>;
}

export interface UplinkTransportConnection extends IpcConnection {
  writeBinary(bytes: Uint8Array): Promise<void>;
  onBinary(listener: (bytes: Uint8Array) => void): () => void;
  readonly unsentBytes: number;
  onSent(listener: () => void): () => void;
}
