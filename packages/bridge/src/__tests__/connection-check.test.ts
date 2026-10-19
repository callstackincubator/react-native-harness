import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectionCheck, type PingableSocket } from '../connection-check.js';

const createFakeSocket = (options: { answersPings: boolean }) => {
  const listeners = new Set<() => void>();
  const socket = {
    answersPings: options.answersPings,
    ping: vi.fn(() => {
      if (socket.answersPings) {
        for (const listener of listeners) listener();
      }
    }),
    on: (_event: 'pong', listener: () => void) => listeners.add(listener),
    off: (_event: 'pong', listener: () => void) => listeners.delete(listener),
    get listenerCount() {
      return listeners.size;
    },
  };

  return socket satisfies PingableSocket;
};

describe('connection check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays healthy while the socket answers pings', () => {
    const socket = createFakeSocket({ answersPings: true });
    const onLost = vi.fn();
    const check = createConnectionCheck(socket, {
      intervalMs: 10,
      timeoutMs: 30,
      onLost,
    });

    vi.advanceTimersByTime(1_000);

    expect(socket.ping).toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    check.dispose();
  });

  it('reports the connection lost once pongs stop arriving', () => {
    const socket = createFakeSocket({ answersPings: true });
    const onLost = vi.fn();
    createConnectionCheck(socket, { intervalMs: 10, timeoutMs: 30, onLost });

    vi.advanceTimersByTime(100);
    socket.answersPings = false;
    vi.advanceTimersByTime(30);
    expect(onLost).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(onLost).toHaveBeenCalledTimes(1);

    // It reports once and stops pinging.
    const pings = socket.ping.mock.calls.length;
    vi.advanceTimersByTime(100);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(socket.ping).toHaveBeenCalledTimes(pings);
    expect(socket.listenerCount).toBe(0);
  });

  it('stops pinging and removes its listener on dispose', () => {
    const socket = createFakeSocket({ answersPings: false });
    const onLost = vi.fn();
    const check = createConnectionCheck(socket, {
      intervalMs: 10,
      timeoutMs: 30,
      onLost,
    });

    check.dispose();
    vi.advanceTimersByTime(1_000);

    expect(socket.ping).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    expect(socket.listenerCount).toBe(0);
  });
});
