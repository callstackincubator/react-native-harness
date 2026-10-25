import { describe, expect, it } from "vitest";

import { KiB, linkPair, MiB, pattern, settle, signal, TYPE, type LinkPair } from "./testing.js";

async function openPair(pair: LinkPair) {
  const g = await pair.gateway.openChannel({ signal: signal() });
  await settle();
  return { g, w: pair.worker.acceptChannel(g.id) };
}

function dataBytes(entries: LinkPair["gatewayTap"]["sent"]): number {
  return entries.reduce(
    (sum, entry) =>
      entry.kind === "binary" && entry.envelope.type === TYPE.DATA
        ? sum + entry.envelope.payload.length
        : sum,
    0,
  );
}

describe("link lanes", () => {
  it("with the transport held and 1 MiB of channel bytes queued, a text message written next is sent before all but at most 256 KiB plus one 64 KiB message of them", async () => {
    const pair = linkPair();
    const { g } = await openPair(pair);
    pair.gatewayEnd.hold();
    await g.writable.getWriter().write(pattern(0, MiB));
    await settle();

    void pair.gateway.write("urgent\n");
    await settle();

    const sent = pair.gatewayTap.sent;
    const at = sent.findIndex((entry) => entry.kind === "text" && entry.text === "urgent\n");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(dataBytes(sent.slice(0, at))).toBeLessThanOrEqual(256 * KiB + 64 * KiB);
    pair.gatewayEnd.release();
    await settle();
    expect(dataBytes(pair.gatewayTap.sent.slice(at))).toBeGreaterThanOrEqual(
      MiB - (256 * KiB + 64 * KiB),
    );
  });

  it("with text messages written without pause and channel bytes queued, at least one channel message goes out per 64 KiB of text", async () => {
    const pair = linkPair();
    const { g } = await openPair(pair);
    pair.gatewayTap.setUnsent(300 * KiB);
    await g.writable.getWriter().write(pattern(0, MiB));
    await settle();
    expect(dataBytes(pair.gatewayTap.sent)).toBe(0);
    const text = "x".repeat(8 * KiB);

    pair.gatewayTap.setUnsent(0);
    pair.gatewayTap.fireSent();
    for (let i = 0; i < 100; i += 1) void pair.gateway.write(text);
    await settle();

    const sent = pair.gatewayTap.sent;
    const lastText = sent.map((entry) => entry.kind).lastIndexOf("text");
    expect(dataBytes(sent.slice(0, lastText)) / (64 * KiB)).toBeGreaterThanOrEqual(12);
    let run = 0;
    let longest = 0;
    for (const entry of sent) {
      if (entry.kind === "text") run += entry.text.length;
      else if (entry.envelope.type === TYPE.DATA) run = 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(64 * KiB + 8 * KiB);
  });

  it("two channels with bytes queued take turns, one message each", async () => {
    const pair = linkPair();
    const a = await openPair(pair);
    const b = await openPair(pair);
    pair.gatewayTap.setUnsent(300 * KiB);
    await Promise.all([
      a.g.writable.getWriter().write(pattern(0, 512 * KiB)),
      b.g.writable.getWriter().write(pattern(0, 512 * KiB)),
    ]);
    await settle();
    expect(pair.gatewayTap.binaries(TYPE.DATA)).toEqual([]);

    pair.gatewayTap.setUnsent(0);
    pair.gatewayTap.fireSent();
    await settle();

    const numbers = pair.gatewayTap.binaries(TYPE.DATA).map((envelope) => envelope.number);
    expect(numbers).toHaveLength(16);
    expect(new Set(numbers).size).toBe(2);
    for (let i = 1; i < numbers.length; i += 1) expect(numbers[i]).not.toBe(numbers[i - 1]);
  });
});
