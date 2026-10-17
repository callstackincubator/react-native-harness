import {
  ByteLengthQueuingStrategy as PonyfillByteLengthQueuingStrategy,
  ReadableStream as PonyfillReadableStream,
  WritableStream as PonyfillWritableStream,
} from "web-streams-polyfill";

// harness: React Native has no WHATWG streams. The ponyfill fills the gap without
// installing globals, so the app under test sees the runtime it would see in production.

interface StreamGlobals {
  readonly ReadableStream?: typeof globalThis.ReadableStream;
  readonly WritableStream?: typeof globalThis.WritableStream;
  readonly ByteLengthQueuingStrategy?: typeof globalThis.ByteLengthQueuingStrategy;
}

const host = globalThis as StreamGlobals;

// why: one source for all three, so a native stream never meets a ponyfilled strategy.
const native =
  typeof host.ReadableStream === "function" &&
  typeof host.WritableStream === "function" &&
  typeof host.ByteLengthQueuingStrategy === "function";

export const LinkReadableStream: typeof globalThis.ReadableStream = native
  ? (host.ReadableStream as typeof globalThis.ReadableStream)
  : (PonyfillReadableStream as unknown as typeof globalThis.ReadableStream);

export const LinkWritableStream: typeof globalThis.WritableStream = native
  ? (host.WritableStream as typeof globalThis.WritableStream)
  : (PonyfillWritableStream as unknown as typeof globalThis.WritableStream);

export const LinkByteLengthQueuingStrategy: typeof globalThis.ByteLengthQueuingStrategy = native
  ? (host.ByteLengthQueuingStrategy as typeof globalThis.ByteLengthQueuingStrategy)
  : (PonyfillByteLengthQueuingStrategy as unknown as typeof globalThis.ByteLengthQueuingStrategy);
