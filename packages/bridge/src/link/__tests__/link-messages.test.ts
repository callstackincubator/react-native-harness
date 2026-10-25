import { afterEach, describe, expect, it, vi } from "vitest";

import { createLink } from "../index.js";
import {
  errorOfRead,
  errorOfWritable,
  linkPair,
  settle,
  signal,
  RecordingLogger,
} from "./testing.js";
import { startWebSocketPair } from "./test-websocket.js";
import { FakeClock } from "./ports.js";

const MESSAGES = ['{"id":1,"type":"hello"}\n', "second é — ünïcode\n", "third\n"];

async function expectInOrder(
  writer: { write(contents: string): Promise<void> },
  onData: (listener: (chunk: string) => void) => unknown,
): Promise<void> {
  const received: string[] = [];
  onData((chunk) => received.push(chunk));
  for (const message of MESSAGES) await writer.write(message);
  await vi.waitFor(() => expect(received).toEqual(MESSAGES));
}

describe("link text messages", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("text messages written on one link arrive on the other unchanged and in order, over the in-memory pair", async () => {
    const { gateway, worker } = linkPair();

    await expectInOrder(gateway, (listener) => worker.onData(listener));
  });

  it("text messages written on one link arrive on the other unchanged and in order, over the real WebSocket", async () => {
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

    await expectInOrder(gateway, (listener) => worker.onData(listener));
  });

  it("text that arrives before the first onData is delivered to it", async () => {
    const { gateway, worker } = linkPair();
    await gateway.write("early-1\n");
    await gateway.write("early-2\n");
    await settle();

    const received: string[] = [];
    worker.onData((chunk) => received.push(chunk));

    expect(received).toEqual(["early-1\n", "early-2\n"]);
  });

  it("an onClose attached after the close fires at once", async () => {
    const { gateway, worker } = linkPair();
    await worker.close();
    await settle();

    const closed = vi.fn();
    gateway.onClose(closed);

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("a pair's fail(error) reaches onError and closes that end", async () => {
    const { gatewayEnd, gateway } = linkPair();
    const errors: Error[] = [];
    gateway.onError((error) => errors.push(error));

    gatewayEnd.fail(new Error("socket reset"));
    await settle();

    expect(errors.map((error) => error.message)).toEqual(["socket reset"]);
    expect(gatewayEnd.closed).toBe(true);
  });

  it("closing the transport fails every open channel with closed", async () => {
    const { gateway, gatewayEnd, worker } = linkPair();
    const opened = await gateway.openChannel({ signal: signal() });
    const accepted = worker.acceptChannel(opened.id);

    await gatewayEnd.close();
    await settle();

    await expect(errorOfRead(opened.readable)).resolves.toMatchObject({ reason: "closed" });
    await expect(errorOfWritable(opened.writable)).resolves.toMatchObject({ reason: "closed" });
    await expect(errorOfRead(accepted.readable)).resolves.toMatchObject({ reason: "closed" });
    await expect(errorOfWritable(accepted.writable)).resolves.toMatchObject({ reason: "closed" });
  });

  it("closing the link closes the transport", async () => {
    const { gateway, gatewayEnd, workerEnd } = linkPair();

    await gateway.close();

    expect(gatewayEnd.closed).toBe(true);
    expect(workerEnd.closed).toBe(true);
  });

  it("write resolves when the transport's write resolves", async () => {
    const { gateway, gatewayEnd, worker } = linkPair();
    const received: string[] = [];
    worker.onData((chunk) => received.push(chunk));
    gatewayEnd.hold();
    let resolved = false;

    const write = gateway.write("held\n").then(() => {
      resolved = true;
    });
    await settle();
    expect(resolved).toBe(false);
    expect(received).toEqual([]);

    gatewayEnd.release();
    await write;

    expect(received).toEqual(["held\n"]);
  });

  it("a text message queued at close resolves unsent, also when the pair was held", async () => {
    const { gateway, gatewayEnd, worker } = linkPair();
    const received: string[] = [];
    worker.onData((chunk) => received.push(chunk));
    await gateway.write("before\n");
    await settle();
    expect(received).toEqual(["before\n"]);
    gatewayEnd.hold();

    const write = gateway.write("queued\n");
    await settle();
    await gateway.close();
    await write;
    await settle();

    expect(received).toEqual(["before\n"]);
  });

  it("a text message written after the connection closed resolves without being sent", async () => {
    const { gateway, worker } = linkPair();
    const received: string[] = [];
    worker.onData((chunk) => received.push(chunk));
    await gateway.write("before\n");
    await settle();
    expect(received).toEqual(["before\n"]);
    await gateway.close();

    await gateway.write("late\n");
    await settle();

    expect(received).toEqual(["before\n"]);
  });
});
