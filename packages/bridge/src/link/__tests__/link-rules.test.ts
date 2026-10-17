import { describe, expect, it } from "vitest";

import {
  creditEnvelope,
  dataEnvelope,
  envelope,
  errorOfRead,
  KiB,
  linkWithRawPeer,
  openEnvelope,
  pattern,
  RESET_CODE,
  resetEnvelope,
  settle,
  TYPE,
  type RawPeer,
} from "./testing.js";

async function acceptRaw(peer: RawPeer, number = 2, id = "raw-a") {
  await peer.raw.writeBinary(openEnvelope(number, id));
  await settle();
  return peer.link.acceptChannel(id);
}

async function expectTextFlows(peer: RawPeer): Promise<void> {
  await peer.link.write("ping\n");
  await peer.raw.write("pong\n");
  await settle();
  expect(peer.receivedText).toContain("ping\n");
  expect(peer.linkText).toContain("pong\n");
}

function resets(peer: RawPeer, number: number) {
  return peer.received.filter((e) => e.type === TYPE.RESET && e.number === number);
}

interface Break {
  readonly name: string;
  readonly run: (peer: RawPeer) => Promise<unknown>;
}

const channelBreaks: Break[] = [
  {
    name: "DATA past the allowed bytes",
    run: async (peer) => {
      const channel = await acceptRaw(peer);
      for (let i = 0; i < 64; i += 1) await peer.raw.writeBinary(dataEnvelope(2, 64 * KiB));
      await settle();
      expect(resets(peer, 2)).toEqual([]);
      await peer.raw.writeBinary(dataEnvelope(2, 1));
      return channel;
    },
  },
  {
    name: "DATA over 64 KiB",
    run: async (peer) => {
      const channel = await acceptRaw(peer);
      await peer.raw.writeBinary(dataEnvelope(2, 64 * KiB));
      await settle();
      expect(resets(peer, 2)).toEqual([]);
      await peer.raw.writeBinary(dataEnvelope(2, 64 * KiB + 1));
      return channel;
    },
  },
  {
    name: "DATA after that direction ended",
    run: async (peer) => {
      const channel = await acceptRaw(peer);
      await peer.raw.writeBinary(envelope(TYPE.END, 2));
      await settle();
      expect(resets(peer, 2)).toEqual([]);
      await peer.raw.writeBinary(dataEnvelope(2, 10));
      return channel;
    },
  },
  {
    name: "END after that direction ended",
    run: async (peer) => {
      const channel = await acceptRaw(peer);
      await peer.raw.writeBinary(envelope(TYPE.END, 2));
      await settle();
      expect(resets(peer, 2)).toEqual([]);
      await peer.raw.writeBinary(envelope(TYPE.END, 2));
      return channel;
    },
  },
  {
    name: "a CREDIT of 0",
    run: async (peer) => {
      const channel = await acceptRaw(peer);
      await channel.writable.getWriter().write(pattern(0, KiB));
      await peer.raw.writeBinary(creditEnvelope(2, KiB));
      await settle();
      expect(resets(peer, 2)).toEqual([]);
      await peer.raw.writeBinary(creditEnvelope(2, 0));
      return channel;
    },
  },
  {
    name: "credit beyond 4 MiB outstanding",
    run: async (peer) => {
      const channel = await acceptRaw(peer);
      await channel.writable.getWriter().write(pattern(0, 64 * KiB));
      await peer.raw.writeBinary(creditEnvelope(2, 64 * KiB));
      await settle();
      expect(resets(peer, 2)).toEqual([]);
      await peer.raw.writeBinary(creditEnvelope(2, 1));
      return channel;
    },
  },
];

describe("link rule breaks that name a held channel", () => {
  for (const rule of channelBreaks) {
    it(`${rule.name} is dropped, resets the channel it names with invalid, is logged, and leaves text flowing`, async () => {
      const peer = linkWithRawPeer();
      const channel = (await rule.run(peer)) as Awaited<ReturnType<typeof acceptRaw>>;
      await settle();

      const named = resets(peer, 2);
      expect(named).toHaveLength(1);
      expect(named[0]?.payload[0]).toBe(RESET_CODE.invalid);
      await expect(errorOfRead(channel.readable)).resolves.toMatchObject({ reason: "invalid" });
      expect(peer.log.problems().length).toBeGreaterThan(0);
      await expectTextFlows(peer);
    });
  }
});

interface Dropped {
  readonly name: string;
  readonly run: (peer: RawPeer) => Promise<void>;
  readonly neverAccepted?: string;
}

const dropped: Dropped[] = [
  {
    name: "a channel number the peer never opened",
    run: async (peer) => {
      await acceptRaw(peer);
      await peer.raw.writeBinary(dataEnvelope(10, 5));
    },
  },
  {
    name: "an OPEN reusing a live number",
    neverAccepted: "raw-b",
    run: async (peer) => {
      await acceptRaw(peer);
      await peer.raw.writeBinary(openEnvelope(2, "raw-b"));
    },
  },
  {
    name: "an OPEN with the wrong parity",
    neverAccepted: "raw-c",
    run: async (peer) => {
      await peer.raw.writeBinary(openEnvelope(3, "raw-c"));
    },
  },
  {
    name: "a 65th OPEN from the peer",
    neverAccepted: "raw-65",
    run: async (peer) => {
      for (let i = 1; i <= 64; i += 1) {
        await peer.raw.writeBinary(openEnvelope(i * 2, `raw-${String(i)}`));
      }
      await settle();
      expect(peer.log.problems()).toEqual([]);
      expect(() => peer.link.acceptChannel("raw-64")).not.toThrow();
      await peer.raw.writeBinary(openEnvelope(130, "raw-65"));
    },
  },
  {
    name: "an unknown envelope type",
    run: async (peer) => {
      await acceptRaw(peer);
      await peer.raw.writeBinary(envelope(99, 2));
      await settle();
      expect(peer.log.problems().join("\n")).toContain("an unknown envelope type");
      expect(resets(peer, 2)).toEqual([]);
    },
  },
  {
    name: "a message too short to read",
    run: async (peer) => {
      await peer.raw.writeBinary(new Uint8Array([TYPE.DATA, 0, 0]));
    },
  },
];

describe("link rule breaks that name no held channel", () => {
  for (const rule of dropped) {
    it(`${rule.name} is dropped and logged and leaves text flowing`, async () => {
      const peer = linkWithRawPeer();
      await rule.run(peer);
      await settle();

      expect(peer.log.problems().length).toBeGreaterThan(0);
      if (rule.neverAccepted !== undefined) {
        expect(() => peer.link.acceptChannel(rule.neverAccepted as string)).toThrow();
      }
      await expectTextFlows(peer);
    });
  }
});

describe("link late traffic for an ended channel", () => {
  it("a RESET for a channel this side does not hold is dropped and not answered", async () => {
    const peer = linkWithRawPeer();
    await acceptRaw(peer);
    await peer.raw.writeBinary(resetEnvelope(2, "aborted"));
    await settle();
    const before = peer.received.length;
    const problems = peer.log.problems().length;

    await peer.raw.writeBinary(resetEnvelope(2, "aborted"));
    await settle();

    expect(peer.received).toHaveLength(before);
    expect(peer.log.problems()).toHaveLength(problems);
    await expectTextFlows(peer);
  });

  it("a STOP that arrives after its channel ended on this side is dropped quietly: no log, no reset, no answer", async () => {
    const peer = linkWithRawPeer();
    const channel = await acceptRaw(peer);
    await channel.writable.getWriter().close();
    await settle();
    expect(peer.received.some((e) => e.type === TYPE.END && e.number === 2)).toBe(true);
    await peer.raw.writeBinary(envelope(TYPE.END, 2));
    await settle();
    const before = peer.received.length;
    const records = peer.log.records.length;

    await peer.raw.writeBinary(envelope(TYPE.STOP, 2));
    await settle();

    expect(peer.received).toHaveLength(before);
    expect(peer.log.records).toHaveLength(records);
  });
});
