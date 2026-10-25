import { afterEach, describe, expect, it, vi } from "vitest";

import { createConnectionPair } from "./ports.js";
import { pattern, RecordingLogger, settle, signal } from "./testing.js";

// React Native has no WHATWG streams: the link must fall back to the ponyfill.
describe("link: with no WHATWG streams in the runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("a channel carries bytes both ways on ponyfilled streams", async () => {
    const NativeReadableStream = globalThis.ReadableStream;
    vi.stubGlobal("ReadableStream", undefined);
    vi.stubGlobal("WritableStream", undefined);
    vi.stubGlobal("ByteLengthQueuingStrategy", undefined);
    vi.resetModules();
    const { createLink, globalClock } = await import("../index.js");
    const [workerEnd, gatewayEnd] = createConnectionPair();
    const options = { clock: globalClock, logger: new RecordingLogger() };
    const worker = createLink(workerEnd, { ...options, end: "worker", generateId: () => "w-1" });
    const gateway = createLink(gatewayEnd, { ...options, end: "gateway" });

    const opened = await worker.openChannel({ signal: signal() });
    await settle();
    const accepted = gateway.acceptChannel(opened.id);
    const data = pattern(0, 6 * 1024 * 1024);

    const read = async (readable: ReadableStream<Uint8Array>) => {
      const reader = readable.getReader();
      let total = 0;
      let intact = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { intact, total };
        for (let i = 0; i < value.length; i += 1) {
          if (value[i] !== (total + i) % 251) intact = false;
        }
        total += value.length;
      }
    };
    const write = async (writable: WritableStream<Uint8Array>) => {
      const writer = writable.getWriter();
      await writer.write(data);
      await writer.close();
    };

    expect(accepted.readable).not.toBeInstanceOf(NativeReadableStream);
    const [up, down] = await Promise.all([
      read(accepted.readable),
      read(opened.readable),
      write(opened.writable),
      write(accepted.writable),
    ]);

    expect(up).toEqual({ intact: true, total: data.length });
    expect(down).toEqual({ intact: true, total: data.length });
  });
});
