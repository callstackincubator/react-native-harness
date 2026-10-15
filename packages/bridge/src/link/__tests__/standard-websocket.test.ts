import { describe, expect, it, vi } from "vitest";

import { FakeClock } from "./ports.js";
import {
  connectStandardWebSocket,
  StandardWebSocketConnection,
  type StandardWebSocket,
} from "../standard-websocket.js";

type Listener = (event: unknown) => void;

class FakeSocket implements StandardWebSocket {
  binaryType = "blob";
  bufferedAmount = 0;
  readyState = 1;
  readonly sent: Array<string | Uint8Array> = [];
  readonly #listeners = new Map<string, Set<Listener>>();
  retain = (size: number) => size;

  send(data: string | ArrayBufferView): void {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
    this.sent.push(typeof data === "string" ? data : new Uint8Array(data.buffer));
    this.bufferedAmount += this.retain(bytes);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  addEventListener(type: string, listener: never): void {
    const set = this.#listeners.get(type) ?? new Set<Listener>();
    set.add(listener as Listener);
    this.#listeners.set(type, set);
  }

  removeEventListener(type: string, listener: never): void {
    this.#listeners.get(type)?.delete(listener as Listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

async function microtasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function setup(pollMs = 4) {
  const socket = new FakeSocket();
  const clock = new FakeClock(0);
  const connection = new StandardWebSocketConnection(socket, { clock, pollMs });
  return { clock, connection, socket };
}

describe("standard WebSocket transport", () => {
  it("asks the socket for ArrayBuffers, since a Blob cannot be read without reordering messages", () => {
    const { socket } = setup();

    expect(socket.binaryType).toBe("arraybuffer");
  });

  it("text and binary messages reach their own listeners, binary as a Uint8Array over the same bytes", () => {
    const { connection, socket } = setup();
    const text: string[] = [];
    const binary: number[][] = [];
    connection.onData((chunk) => text.push(chunk));
    connection.onBinary((bytes) => binary.push(Array.from(bytes)));

    socket.emit("message", { data: "hello é" });
    socket.emit("message", { data: new Uint8Array([1, 2, 3]).buffer });
    socket.emit("message", { data: new Uint8Array([9, 8, 7, 6]).subarray(1, 3) });

    expect(text).toEqual(["hello é"]);
    expect(binary).toEqual([
      [1, 2, 3],
      [8, 7],
    ]);
  });

  it("text that arrives before the first onData is delivered to it, in order", () => {
    const { connection, socket } = setup();
    socket.emit("message", { data: "one" });
    socket.emit("message", { data: "two" });

    const seen: string[] = [];
    connection.onData((chunk) => seen.push(chunk));
    socket.emit("message", { data: "three" });

    expect(seen).toEqual(["one", "two", "three"]);
  });

  it("a write whose bytes sit in the buffer stays pending until they leave, and reports them sent", async () => {
    const { clock, connection, socket } = setup();
    const sent = vi.fn();
    connection.onSent(sent);

    let settled = false;
    const written = connection.writeBinary(new Uint8Array(1000)).then(() => {
      settled = true;
    });
    await microtasks();

    expect(connection.unsentBytes).toBe(1000);
    expect(settled).toBe(false);

    socket.bufferedAmount = 0;
    clock.advance(4);
    await written;

    expect(settled).toBe(true);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("a socket that never sets bufferedAmount, as React Native's does not, still settles writes", async () => {
    const socket = new FakeSocket();
    Object.defineProperty(socket, "bufferedAmount", { get: () => undefined, set: () => undefined });
    const clock = new FakeClock(0);
    const connection = new StandardWebSocketConnection(socket, { clock });

    await connection.writeBinary(new Uint8Array(1000));
    await connection.write("tiny");

    expect(connection.unsentBytes).toBe(0);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("a write the socket took whole settles without waiting for a timer", async () => {
    const { clock, connection, socket } = setup();
    socket.retain = () => 0;

    await connection.write("tiny");

    expect(clock.pendingTimerCount).toBe(0);
    expect(socket.sent).toEqual(["tiny"]);
  });

  it("each write settles when its own bytes have left, not before, and onSent fires once per step the buffer shrinks", async () => {
    const { clock, connection, socket } = setup();
    const sent = vi.fn();
    connection.onSent(sent);
    const order: string[] = [];
    const first = connection.writeBinary(new Uint8Array(300)).then(() => order.push("first"));
    const second = connection.writeBinary(new Uint8Array(300)).then(() => order.push("second"));
    const third = connection.writeBinary(new Uint8Array(300)).then(() => order.push("third"));
    await microtasks();

    socket.bufferedAmount = 500;
    clock.advance(4);
    await first;
    expect(order).toEqual(["first"]);

    socket.bufferedAmount = 200;
    clock.advance(4);
    await second;
    expect(order).toEqual(["first", "second"]);

    socket.bufferedAmount = 0;
    clock.advance(4);
    await third;

    expect(order).toEqual(["first", "second", "third"]);
    expect(sent).toHaveBeenCalledTimes(3);
  });

  it("checks on a timer only while something is buffered", async () => {
    const { clock, connection, socket } = setup();
    const written = connection.write("x".repeat(100));
    await microtasks();
    expect(clock.pendingTimerCount).toBe(1);

    socket.bufferedAmount = 0;
    clock.advance(4);
    await written;

    expect(clock.pendingTimerCount).toBe(0);
  });

  it("a message from the peer is taken as news that bytes are moving, and settles a drained write with no timer", async () => {
    const { clock, connection, socket } = setup();
    connection.onBinary(() => undefined);
    const written = connection.writeBinary(new Uint8Array(100));
    await microtasks();

    socket.bufferedAmount = 0;
    socket.emit("message", { data: new ArrayBuffer(5) });

    await written;
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("closing settles every pending write, cancels the timer, and does not report sent for bytes that never left", async () => {
    const { clock, connection } = setup();
    const sent = vi.fn();
    connection.onSent(sent);
    const written = connection.writeBinary(new Uint8Array(100));
    await microtasks();

    await connection.close();
    await written;

    expect(clock.pendingTimerCount).toBe(0);
    expect(sent).not.toHaveBeenCalled();
    expect(connection.closed).toBe(true);
  });

  it("a write after the close sends nothing and settles", async () => {
    const { connection, socket } = setup();
    await connection.close();

    await connection.write("late");
    await connection.writeBinary(new Uint8Array(3));

    expect(socket.sent).toEqual([]);
  });

  it("a close from the peer fires onClose once, and an onClose attached after fires at once", () => {
    const { connection, socket } = setup();
    const closed = vi.fn();
    connection.onClose(closed);

    socket.emit("close", {});
    socket.emit("close", {});
    const late = vi.fn();
    connection.onClose(late);

    expect(closed).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("an error event reaches onError as an Error and closes the connection", () => {
    const { connection, socket } = setup();
    const errors: Error[] = [];
    connection.onError((error) => errors.push(error));

    socket.emit("error", {});
    socket.emit("error", { error: new Error("reset") });

    expect(errors.map((error) => error.message)).toEqual(["WebSocket error", "reset"]);
    expect(connection.closed).toBe(true);
  });

  it("connecting resolves on open with the connection already listening, and rejects if the socket closes first", async () => {
    const opening = new FakeSocket();
    opening.readyState = 0;
    const connecting = connectStandardWebSocket({ createSocket: () => opening, url: "ws://x" });
    opening.emit("message", { data: "spoke first" });
    opening.readyState = 1;
    opening.emit("open", {});
    const connection = await connecting;
    const seen: string[] = [];
    connection.onData((chunk) => seen.push(chunk));

    expect(seen).toEqual(["spoke first"]);

    const refused = new FakeSocket();
    refused.readyState = 0;
    const failing = connectStandardWebSocket({ createSocket: () => refused, url: "ws://y" });
    refused.emit("close", {});

    await expect(failing).rejects.toThrow(/could not open/);
  });
});
