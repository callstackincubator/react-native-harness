import { afterEach, describe, expect, it } from "vitest";

import { createLink, type LinkChannel } from "../index.js";
import {
  drain,
  endChannel,
  errorOfRead,
  errorOfWritable,
  KiB,
  linkPair,
  MiB,
  outcome,
  pattern,
  patternHash,
  pump,
  readAll,
  RecordingLogger,
  settle,
  signal,
  TappedTransport,
  TYPE,
  writeAndClose,
  writeUntilBlocked,
  type LinkPair,
} from "./testing.js";
import { startWebSocketPair } from "./test-websocket.js";
import { FakeClock } from "./ports.js";

async function openPair(pair: LinkPair): Promise<{ g: LinkChannel; w: LinkChannel }> {
  const g = await pair.gateway.openChannel({ signal: signal() });
  await settle();
  return { g, w: pair.worker.acceptChannel(g.id) };
}

async function readAtLeast(reader: ReadableStreamDefaultReader<Uint8Array>, bytes: number) {
  let total = 0;
  while (total < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
  }
  return total;
}

async function fillWindow(writable: WritableStream<Uint8Array>) {
  const writer = writable.getWriter();
  for (let i = 0; i < 64; i += 1) await writer.write(pattern(i * 64 * KiB, 64 * KiB));
  return writer;
}

describe("link byte channels: transfer", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  async function realLinks() {
    const sockets = await startWebSocketPair();
    cleanups.push(() => sockets.close());
    const clock = new FakeClock(0);
    const worker = createLink(sockets.worker, {
      clock,
      end: "worker",
      logger: new RecordingLogger(),
    });
    const gateway = createLink(sockets.gateway, {
      clock,
      end: "gateway",
      logger: new RecordingLogger(),
    });
    return { gateway, worker };
  }

  it("20 MiB written to a channel arrives byte for byte at the accepted channel, each way at once, over the real WebSocket", async () => {
    const { gateway, worker } = await realLinks();
    const g = await gateway.openChannel({ signal: signal() });
    await settle();
    const w = worker.acceptChannel(g.id);
    const total = 20 * MiB;

    const [, atWorker, , atGateway] = await Promise.all([
      pump(g.writable, total),
      drain(w.readable),
      pump(w.writable, total),
      drain(g.readable),
    ]);

    const expected = { hash: patternHash(total), length: total };
    expect(atWorker).toEqual(expected);
    expect(atGateway).toEqual(expected);
  }, 60_000);

  it("over the real WebSocket, a 20 MiB channel transfer puts at most 20.2 MiB on the socket, in binary messages", async () => {
    const sockets = await startWebSocketPair();
    cleanups.push(() => sockets.close());
    const tapped = new TappedTransport(sockets.gateway);
    const clock = new FakeClock(0);
    const worker = createLink(sockets.worker, {
      clock,
      end: "worker",
      logger: new RecordingLogger(),
    });
    const gateway = createLink(tapped, { clock, end: "gateway", logger: new RecordingLogger() });
    const g = await gateway.openChannel({ signal: signal() });
    await settle();
    const w = worker.acceptChannel(g.id);

    await Promise.all([pump(g.writable, 20 * MiB), drain(w.readable)]);

    const onSocket = tapped.sent.reduce(
      (sum, entry) => sum + (entry.kind === "binary" ? entry.size : Number.NaN),
      0,
    );
    expect(onSocket).toBeGreaterThanOrEqual(20 * MiB);
    expect(onSocket).toBeLessThanOrEqual(20.2 * MiB);
  }, 60_000);

  it("a text message written right after openChannel resolves never reaches the peer before the channel's OPEN, even with the transport held", async () => {
    const pair = linkPair();
    pair.gatewayEnd.hold();
    const failures: unknown[] = [];
    const seen: string[] = [];
    // eslint-disable-next-line prefer-const -- read by the onData listener before it is assigned
    let opened: LinkChannel | undefined;
    pair.worker.onData((chunk) => {
      try {
        pair.worker.acceptChannel(opened?.id ?? "unopened");
        seen.push(chunk);
      } catch (error: unknown) {
        failures.push(error);
      }
    });
    opened = await pair.gateway.openChannel({ signal: signal() });

    const write = pair.gateway.write("after-open\n");
    pair.gatewayEnd.release();
    await write;
    await settle();

    expect(failures).toEqual([]);
    expect(seen).toEqual(["after-open\n"]);
    const order = pair.gatewayTap.sent.map((entry) =>
      entry.kind === "text" ? "text" : String(entry.envelope.type),
    );
    expect(order.indexOf(String(TYPE.OPEN))).toBeLessThan(order.indexOf("text"));
  });

  it("bytes written right after openChannel, before the peer accepts, arrive once it accepts", async () => {
    const pair = linkPair();
    const g = await pair.gateway.openChannel({ signal: signal() });
    await writeAndClose(g, pattern(0, 100 * KiB));
    await settle();

    const w = pair.worker.acceptChannel(g.id);

    await expect(readAll(w.readable)).resolves.toEqual(pattern(0, 100 * KiB));
  });

  it("with credit left but the bulk lane held, the writable takes the chunks that fit in credit and then at most 64 KiB more before its writer waits", async () => {
    const pair = linkPair();
    const { g } = await openPair(pair);
    pair.gatewayEnd.hold();
    const credit = g.credit;
    expect(credit).toBe(4 * MiB);

    const accepted = await writeUntilBlocked(g.writable.getWriter());

    expect(accepted).toBeGreaterThanOrEqual(credit);
    expect(accepted).toBeLessThanOrEqual(credit + 64 * KiB);
  });

  it("a writer whose peer never accepts stops after 4 MiB; 30 s after the open its streams error with not-accepted, and the peer's acceptChannel for that id then throws", async () => {
    const pair = linkPair();
    const g = await pair.gateway.openChannel({ signal: signal() });
    await settle();
    const writer = g.writable.getWriter();

    const accepted = await writeUntilBlocked(writer);
    expect(accepted).toBeGreaterThanOrEqual(4 * MiB);
    expect(accepted).toBeLessThanOrEqual(4 * MiB + 64 * KiB);
    pair.clock.advance(30_000);
    await settle();

    await expect(writer.closed).rejects.toMatchObject({ reason: "not-accepted" });
    await expect(errorOfRead(g.readable)).resolves.toMatchObject({ reason: "not-accepted" });
    expect(() => pair.worker.acceptChannel(g.id)).toThrow();
  });

  it("a reader that stops reading holds its writer after 4 MiB unread, and reading again lets it go on", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const writer = g.writable.getWriter();

    const first = await writeUntilBlocked(writer);
    expect(first).toBeGreaterThanOrEqual(4 * MiB);
    expect(first).toBeLessThanOrEqual(4 * MiB + 64 * KiB);
    expect(await readAtLeast(w.readable.getReader(), MiB)).toBeGreaterThanOrEqual(MiB);
    await settle();
    const more = await writeUntilBlocked(writer);

    expect(more).toBeGreaterThan(0);
  });

  it("a single 20 MiB write goes through in parts as credit arrives, and resolves once all of it is taken", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const writer = g.writable.getWriter();
    let resolved = false;

    const write = writer.write(pattern(0, 20 * MiB)).then(() => {
      resolved = true;
    });
    await settle();
    expect(resolved).toBe(false);
    const received = drain(w.readable);
    expect((await outcome(write)).state).toBe("resolved");
    await writer.close();

    const arrived = await outcome(received);
    expect(arrived).toEqual({
      state: "resolved",
      value: { hash: patternHash(20 * MiB), length: 20 * MiB },
    });
  });

  it("one channel's stalled reader does not slow another channel on the same link", async () => {
    const pair = linkPair();
    const stalled = await openPair(pair);
    const live = await openPair(pair);
    await writeUntilBlocked(stalled.g.writable.getWriter());

    const outcome = await Promise.race([
      Promise.all([pump(live.g.writable, 2 * MiB), drain(live.w.readable)]).then(
        ([, received]) => received,
      ),
      new Promise((resolve) =>
        setTimeout(() => resolve("stuck behind the stalled channel"), 10_000),
      ),
    ]);

    expect(outcome).toEqual({ hash: patternHash(2 * MiB), length: 2 * MiB });
  });
});

describe("link byte channels: credit and stalls", () => {
  it("a write that waits 60 s with no credit arriving errors both sides' streams with stalled", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const writer = g.writable.getWriter();
    await writeUntilBlocked(writer);

    pair.clock.advance(60_000);
    await settle();

    const stalled = { state: "resolved", value: { reason: "stalled" } };
    expect(await outcome(writer.closed)).toMatchObject({
      state: "rejected",
      error: { reason: "stalled" },
    });
    expect(await outcome(errorOfRead(g.readable))).toMatchObject(stalled);
    expect(await outcome(errorOfRead(w.readable))).toMatchObject(stalled);
    expect(await outcome(errorOfWritable(w.writable))).toMatchObject(stalled);
  });

  it("a reader that reads 64 KiB every 50 s keeps a 10 MiB transfer going without a reset", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const total = 10 * MiB;
    const sending = pump(g.writable, total);
    const reader = w.readable.getReader();
    let received = 0;

    while (received < total) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      pair.clock.advance(50_000);
      await settle();
    }
    await sending;

    expect(received).toBe(total);
    expect(pair.gatewayLog.problems()).toEqual([]);
    expect(pair.workerLog.problems()).toEqual([]);
  }, 60_000);

  it("credit counts down as the writer writes and up as the peer reads", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    expect(g.credit).toBe(4 * MiB);
    const writer = g.writable.getWriter();

    for (let i = 0; i < 16; i += 1) await writer.write(pattern(i * 64 * KiB, 64 * KiB));
    expect(g.credit).toBe(3 * MiB);
    await readAtLeast(w.readable.getReader(), MiB);
    await settle();

    expect(g.credit).toBeGreaterThan(3 * MiB);
    expect(g.credit).toBeLessThanOrEqual(4 * MiB);
  });

  it("whenCredit() resolves when credit arrives", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    await fillWindow(g.writable);
    expect(g.credit).toBe(0);
    let resolved = false;
    const waiting = g.whenCredit().then(() => {
      resolved = true;
    });
    await settle();
    expect(resolved).toBe(false);

    await readAtLeast(w.readable.getReader(), 64 * KiB);
    await settle();

    expect(resolved).toBe(true);
    await waiting;
    expect(g.credit).toBeGreaterThan(0);
  });

  it("whenCredit() rejects when the channel fails", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    await fillWindow(g.writable);
    const waiting = outcome(g.whenCredit());

    w.abort();

    expect(await waiting).toMatchObject({ state: "rejected", error: { reason: "aborted" } });
  });

  it("whenCredit() rejects when the peer stops that direction", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    await fillWindow(g.writable);
    const waiting = outcome(g.whenCredit());

    await w.readable.cancel();

    expect(await waiting).toMatchObject({ state: "rejected", error: { reason: "stopped" } });
  });

  it("whenCredit() rejects when this side closes its own writable", async () => {
    const pair = linkPair();
    const { g } = await openPair(pair);
    const writer = await fillWindow(g.writable);
    const waiting = outcome(g.whenCredit());

    await writer.close();

    const ended = await waiting;
    expect(ended.state).toBe("rejected");
    expect((ended as { error: unknown }).error).toBeInstanceOf(Error);
  });

  it("a whenCredit() pending 60 s, with the peer holding every byte and granting nothing, errors the channel stalled", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    await fillWindow(g.writable);
    const waiting = outcome(g.whenCredit());

    pair.clock.advance(60_000);

    expect(await waiting).toMatchObject({ state: "rejected", error: { reason: "stalled" } });
    expect(await outcome(errorOfRead(w.readable))).toMatchObject({
      state: "resolved",
      value: { reason: "stalled" },
    });
  });

  it("with the transport held for 90 s and a write waiting behind it, the channel is not reset", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const writer = g.writable.getWriter();
    pair.gatewayEnd.hold();
    const write = writer.write(pattern(0, 8 * MiB));
    await settle();

    pair.clock.advance(90_000);
    await settle();
    pair.gatewayEnd.release();
    const received = drain(w.readable);
    expect((await outcome(write)).state).toBe("resolved");
    await writer.close();

    expect(await outcome(received)).toEqual({
      state: "resolved",
      value: { hash: patternHash(8 * MiB), length: 8 * MiB },
    });
    expect(pair.gatewayLog.problems()).toEqual([]);
  });

  it("a writer that writes no more than credit, against a reader that reads nothing for 10 minutes, is never reset", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const writer = await fillWindow(g.writable);

    pair.clock.advance(600_000);
    await settle();
    await writer.close();

    await expect(drain(w.readable)).resolves.toEqual({
      hash: patternHash(4 * MiB),
      length: 4 * MiB,
    });
  });

  it("a channel whose peer sends nothing for 10 minutes, with no write waiting, stays open", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);

    pair.clock.advance(600_000);
    await settle();
    await writeAndClose(g, pattern(0, 10));

    await expect(readAll(w.readable)).resolves.toEqual(pattern(0, 10));
  });
});

describe("link byte channels: ending", () => {
  it("closing a writable ends the peer's readable", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);

    await writeAndClose(g, pattern(0, 1000));

    await expect(readAll(w.readable)).resolves.toEqual(pattern(0, 1000));
  });

  it("after one side closes its writable, the other side's bytes still travel back to the side that closed", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);

    await g.writable.getWriter().close();
    await settle();
    await writeAndClose(w, pattern(0, 700));

    expect(await outcome(readAll(g.readable))).toEqual({
      state: "resolved",
      value: pattern(0, 700),
    });
  });

  it("cancelling a readable errors the peer's writable with stopped, and the other direction still carries bytes to its end", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const writer = g.writable.getWriter();

    await w.readable.cancel();
    await settle();

    await expect(writer.closed).rejects.toMatchObject({ reason: "stopped" });
    await writeAndClose(w, pattern(0, 500));
    await expect(readAll(g.readable)).resolves.toEqual(pattern(0, 500));
  });

  it("DATA still in flight when a readable is cancelled is dropped without a reset, and the peer's acknowledging END arrives", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const writer = g.writable.getWriter();
    pair.gatewayEnd.hold();
    await writer.write(pattern(0, 10 * KiB));
    await settle();
    const before = pair.gatewayTap.binaries(TYPE.DATA).length;
    expect(before).toBe(1);

    await w.readable.cancel();
    await settle();
    pair.gatewayEnd.release();
    await settle();

    expect(pair.workerTap.binaries(TYPE.RESET)).toEqual([]);
    expect(pair.gatewayTap.binaries(TYPE.RESET)).toEqual([]);
    expect(pair.workerLog.problems()).toEqual([]);
    const types = pair.gatewayTap.binaries().map((entry) => entry.type);
    expect(types.indexOf(TYPE.END)).toBeGreaterThan(types.indexOf(TYPE.DATA));
  });

  it("a STOP and an END for the same direction crossing on the wire end that direction on both sides with no reset and no second END", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    pair.gatewayEnd.hold();
    pair.workerEnd.hold();
    const gWriter = g.writable.getWriter();

    const closing = gWriter.close();
    void w.readable.cancel();
    await settle();
    pair.gatewayEnd.release();
    pair.workerEnd.release();
    await closing;
    await settle();
    await writeAndClose(w, pattern(0, 10));
    await readAll(g.readable);
    await settle();

    expect(pair.gatewayTap.binaries(TYPE.END)).toHaveLength(1);
    expect(pair.gatewayTap.binaries(TYPE.RESET)).toEqual([]);
    expect(pair.workerTap.binaries(TYPE.RESET)).toEqual([]);
    expect(pair.gatewayLog.problems()).toEqual([]);
    expect(pair.workerLog.problems()).toEqual([]);
  });

  it("cancelling a readable after its END arrived sends nothing", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    await writeAndClose(g, pattern(0, 10));
    await settle();

    await w.readable.cancel();
    await settle();

    expect(pair.workerTap.binaries(TYPE.STOP)).toEqual([]);
    expect(pair.gatewayLog.problems()).toEqual([]);
  });

  it("grants credit once per 64 KiB read, or when the reader has read everything it holds", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    const writer = g.writable.getWriter();
    for (let i = 0; i < 100; i += 1) await writer.write(pattern(i * KiB, KiB));
    await settle();

    const reader = w.readable.getReader();
    let read = 0;
    while (read < 100 * KiB) read += (await reader.read()).value?.length ?? 0;
    await settle();

    const grants = pair.workerTap
      .binaries(TYPE.CREDIT)
      .map((e) => new DataView(e.payload.buffer, e.payload.byteOffset).getUint32(0));
    expect(grants).toEqual([64 * KiB, 36 * KiB]);
  });

  it("abort(\"why\") on one side errors both streams on both sides with aborted; the aborting side's error message is why and the peer's carries no reason string", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);

    g.abort("why");
    await settle();

    const own = [await errorOfRead(g.readable), await errorOfWritable(g.writable)];
    const peer = [await errorOfRead(w.readable), await errorOfWritable(w.writable)];
    for (const error of own) {
      expect(error).toMatchObject({ message: "why", reason: "aborted" });
    }
    for (const error of peer) {
      expect(error).toMatchObject({ reason: "aborted" });
      expect((error as Error).message).not.toContain("why");
    }
  });
});

describe("link byte channels: ids and numbers", () => {
  it("acceptChannel throws for an id never opened", () => {
    const pair = linkPair();

    expect(() => pair.worker.acceptChannel("never-opened")).toThrow();
  });

  it("acceptChannel throws for an id already accepted", async () => {
    const pair = linkPair();
    const { g } = await openPair(pair);

    expect(() => pair.worker.acceptChannel(g.id)).toThrow();
  });

  it("acceptChannel throws for an id already ended", async () => {
    const pair = linkPair();
    const { g, w } = await openPair(pair);
    await endChannel(g, w);
    await settle();

    expect(() => pair.worker.acceptChannel(g.id)).toThrow();
  });

  it("channel ids match [A-Za-z0-9-]{1,32}, checked over 200 channels from each end", async () => {
    const pair = linkPair();
    const ids: string[] = [];

    for (let i = 0; i < 200; i += 1) {
      const g = await pair.gateway.openChannel({ signal: signal() });
      const w = await pair.worker.openChannel({ signal: signal() });
      ids.push(g.id, w.id);
      await settle();
      const gAccepted = pair.worker.acceptChannel(g.id);
      const wAccepted = pair.gateway.acceptChannel(w.id);
      await Promise.all([endChannel(g, gAccepted), endChannel(w, wAccepted)]);
    }

    expect(ids).toHaveLength(400);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9-]{1,32}$/);
  }, 60_000);

  it("50 channels opened at once from each end never collide", async () => {
    const pair = linkPair();

    const [fromGateway, fromWorker] = await Promise.all([
      Promise.all(Array.from({ length: 50 }, () => pair.gateway.openChannel({ signal: signal() }))),
      Promise.all(Array.from({ length: 50 }, () => pair.worker.openChannel({ signal: signal() }))),
    ]);
    await settle();

    const reads: Array<Promise<void>> = [];
    fromGateway.forEach((channel, index) => {
      const accepted = pair.worker.acceptChannel(channel.id);
      void writeAndClose(channel, new TextEncoder().encode(`g-${String(index)}`));
      reads.push(
        readAll(accepted.readable).then((bytes) => {
          expect(new TextDecoder().decode(bytes)).toBe(`g-${String(index)}`);
        }),
      );
    });
    fromWorker.forEach((channel, index) => {
      const accepted = pair.gateway.acceptChannel(channel.id);
      void writeAndClose(channel, new TextEncoder().encode(`w-${String(index)}`));
      reads.push(
        readAll(accepted.readable).then((bytes) => {
          expect(new TextDecoder().decode(bytes)).toBe(`w-${String(index)}`);
        }),
      );
    });
    await Promise.all(reads);

    const numbers = (tap: LinkPair["gatewayTap"]) => tap.binaries(TYPE.OPEN).map((e) => e.number);
    expect(new Set(numbers(pair.gatewayTap)).size).toBe(50);
    expect(new Set(numbers(pair.workerTap)).size).toBe(50);
    expect(numbers(pair.gatewayTap).every((n) => n % 2 === 0)).toBe(true);
    expect(numbers(pair.workerTap).every((n) => n % 2 === 1)).toBe(true);
  });

  it("200 channels opened and ended one after another each get a new number", async () => {
    const pair = linkPair();

    for (let i = 0; i < 200; i += 1) {
      const { g, w } = await openPair(pair);
      await writeAndClose(g, new TextEncoder().encode(`n-${String(i)}`));
      expect(new TextDecoder().decode(await readAll(w.readable))).toBe(`n-${String(i)}`);
      await Promise.all([w.writable.getWriter().close(), drain(g.readable)]);
    }

    const numbers = pair.gatewayTap.binaries(TYPE.OPEN).map((entry) => entry.number);
    expect(numbers).toHaveLength(200);
    expect(new Set(numbers).size).toBe(200);
  }, 60_000);

  it("with this side's numbers exhausted, the next openChannel rejects and the link logs it", async () => {
    const pair = linkPair({ gatewayFirstNumber: 0xfffffffe });
    const outcomes: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      outcomes.push(
        await pair.gateway.openChannel({ signal: signal() }).then(
          () => "opened",
          () => "rejected",
        ),
      );
    }

    expect(outcomes.slice(1)).toEqual(["rejected", "rejected"]);
    expect(pair.gatewayLog.problems().length).toBeGreaterThan(0);
  });
});

describe("link byte channels: the 64 channel limit", () => {
  async function open64(pair: LinkPair) {
    const opened: LinkChannel[] = [];
    for (let i = 0; i < 64; i += 1) {
      opened.push(await pair.gateway.openChannel({ signal: signal() }));
    }
    await settle();
    return opened.map((g) => ({ g, w: pair.worker.acceptChannel(g.id) }));
  }

  it("the 65th openChannel waits, and resolves once one ends", async () => {
    const pair = linkPair();
    const open = await open64(pair);
    let state = "pending";
    const next = pair.gateway.openChannel({ signal: signal() }).then(
      () => (state = "opened"),
      () => (state = "rejected"),
    );
    await settle();
    expect(state).toBe("pending");

    await endChannel(open[0]!.g, open[0]!.w);
    await next;

    expect(state).toBe("opened");
  });

  it("an abort after this side's END was written, with the peer's END still in flight, frees the slot once that END arrives", async () => {
    const pair = linkPair();
    const open = await open64(pair);
    const { g, w } = open[0]!;
    pair.workerEnd.hold();
    await g.writable.getWriter().close();
    await w.writable.getWriter().close();
    await settle();

    g.abort();
    await settle();
    pair.workerEnd.release();
    const next = pair.gateway.openChannel({ signal: signal() });

    expect((await outcome(next)).state).toBe("resolved");
  });

  it("the 65th openChannel rejects with the signal's reason when its signal aborts first", async () => {
    const pair = linkPair();
    await open64(pair);
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    const next = pair.gateway.openChannel({ signal: controller.signal });
    await settle();

    controller.abort(reason);

    await expect(next).rejects.toBe(reason);
  });

  it("the 65th openChannel rejects with closed when the connection closes", async () => {
    const pair = linkPair();
    await open64(pair);
    const next = expect(pair.gateway.openChannel({ signal: signal() })).rejects.toMatchObject({
      reason: "closed",
    });
    await settle();

    await pair.gateway.close();

    await next;
  });

  it("three waiters get slots in the order they asked", async () => {
    const pair = linkPair();
    const open = await open64(pair);
    const order: number[] = [];
    [1, 2, 3].forEach((n) => {
      void pair.gateway.openChannel({ signal: signal() }).then(() => order.push(n));
    });
    await settle();
    expect(order).toEqual([]);

    await endChannel(open[0]!.g, open[0]!.w);
    await settle();
    expect(order).toEqual([1]);
    await endChannel(open[1]!.g, open[1]!.w);
    await settle();
    expect(order).toEqual([1, 2]);
    await endChannel(open[2]!.g, open[2]!.w);
    await settle();

    expect(order).toEqual([1, 2, 3]);
  });

  it("with 64 channels open, ending one and opening another at once never makes the peer see 65, even with the transport held", async () => {
    const pair = linkPair();
    const open = await open64(pair);
    pair.gatewayEnd.hold();
    // why: a held transport only refuses bulk messages once 256 KiB sit unsent, so fill it
    // from another channel; this channel's END then waits behind it and is not yet written.
    void open[1]!.g.writable
      .getWriter()
      .write(pattern(0, MiB))
      .catch(() => undefined);
    await settle();

    let state = "pending";
    const next = pair.gateway.openChannel({ signal: signal() }).then((opened) => {
      state = "opened";
      return opened;
    });
    const ending = endChannel(open[0]!.g, open[0]!.w);
    await settle();
    expect(state).toBe("pending");
    pair.gatewayEnd.release();
    await ending;
    const channel = await next;
    await settle();

    expect(pair.workerLog.problems()).toEqual([]);
    expect(() => pair.worker.acceptChannel(channel.id)).not.toThrow();
  });
});
