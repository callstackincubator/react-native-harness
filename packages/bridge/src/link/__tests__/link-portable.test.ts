import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { utf8Length } from "../envelope.js";
import { createLink } from "../index.js";
import { linkPair, pattern, RecordingLogger, settle, signal, writeAndClose } from "./testing.js";
import { createConnectionPair, FakeClock } from "./ports.js";

async function collect(readable: ReadableStream<Uint8Array>): Promise<number[]> {
  const reader = readable.getReader();
  const bytes: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    for (const byte of value) bytes.push(byte);
  }
}

describe("link: nothing in it needs Node", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("utf8Length counts every string the way Buffer.byteLength does, unpaired surrogates included", () => {
    const samples = [
      "",
      "ascii",
      "é — ünïcode",
      "日本語",
      "emoji 😀 pair",
      "lone high \ud83d end",
      "lone low \ude00 end",
      "\ud83d",
      "\ude00",
      "\ud83d😀",
      '{"id":1,"type":"hello"}\n',
    ];

    for (const sample of samples) expect(utf8Length(sample)).toBe(Buffer.byteLength(sample));
  });

  // harness: stubbing the global Buffer also breaks vitest's own worker messages, so the
  // link's sources are checked for it instead.
  it("no link source uses Buffer, a Node module, or a package other than the streams ponyfill", () => {
    const linkDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const sources = readdirSync(linkDir).filter((name) => name.endsWith(".ts"));
    const imports = /from\s+"([^"]+)"/g;

    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const code = readFileSync(join(linkDir, name), "utf8").replace(/\/\/.*$/gm, "");
      expect(code, name).not.toMatch(/\bBuffer\b/);
      for (const [, specifier] of code.matchAll(imports)) {
        expect(
          specifier?.startsWith("./") || specifier === "web-streams-polyfill",
          `${name} imports ${String(specifier)}`,
        ).toBe(true);
      }
    }
  });

  it("a channel carries bytes both ways with no crypto.randomUUID in the runtime", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37 + 11) % 256;
        return bytes;
      },
    });
    const pair = linkPair();

    const g = await pair.gateway.openChannel({ signal: signal() });
    await settle();
    const w = pair.worker.acceptChannel(g.id);
    const sent = pattern(0, 300_000);
    const received = collect(w.readable);
    await writeAndClose(g, sent);

    expect(g.id).toMatch(/^[0-9a-f]{32}$/);
    expect(await received).toEqual(Array.from(sent));
  });

  it("with no crypto at all, openChannel fails naming generateId, and works once one is passed", async () => {
    vi.stubGlobal("crypto", undefined);
    const [workerEnd, gatewayEnd] = createConnectionPair();
    const clock = new FakeClock(0);
    const without = createLink(gatewayEnd, {
      clock,
      end: "gateway",
      logger: new RecordingLogger(),
    });
    const withIds = createLink(workerEnd, {
      clock,
      end: "worker",
      generateId: () => "chosen-id-1",
      logger: new RecordingLogger(),
    });

    await expect(without.openChannel({ signal: signal() })).rejects.toThrow(/generateId/);
    const channel = await withIds.openChannel({ signal: signal() });

    expect(channel.id).toBe("chosen-id-1");
  });

  it("an id from generateId that the peer would drop is refused when the channel is opened, not lost silently", async () => {
    const [workerEnd] = createConnectionPair();
    const link = createLink(workerEnd, {
      clock: new FakeClock(0),
      end: "worker",
      generateId: () => "not a valid id!",
      logger: new RecordingLogger(),
    });

    await expect(link.openChannel({ signal: signal() })).rejects.toThrow(/\[A-Za-z0-9-\]/);
  });

  it("generateId is asked again when it repeats an id still in use, and the two channels differ", async () => {
    const ids = ["same", "same", "other"];
    const [workerEnd] = createConnectionPair();
    const link = createLink(workerEnd, {
      clock: new FakeClock(0),
      end: "worker",
      generateId: () => ids.shift() ?? "exhausted",
      logger: new RecordingLogger(),
    });

    const first = await link.openChannel({ signal: signal() });
    const second = await link.openChannel({ signal: signal() });

    expect([first.id, second.id]).toEqual(["same", "other"]);
  });
});
