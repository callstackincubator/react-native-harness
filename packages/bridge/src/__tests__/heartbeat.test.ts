import { describe, expect, it, vi } from 'vitest';
import { createHeartbeat } from '../heartbeat.js';

describe('bridge heartbeat', () => {
  it('sends pings and times out stale sessions', () => {
    vi.useFakeTimers();

    const sendPing = vi.fn();
    const onTimeout = vi.fn();
    createHeartbeat({
      sendPing,
      onTimeout,
      intervalMs: 5,
      timeoutMs: 10,
    });

    vi.advanceTimersByTime(5);
    expect(sendPing).toHaveBeenCalledWith(1);

    vi.advanceTimersByTime(10);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('clears the timeout when the matching pong arrives', () => {
    vi.useFakeTimers();

    const sendPing = vi.fn();
    const onTimeout = vi.fn();
    const heartbeat = createHeartbeat({
      sendPing,
      onTimeout,
      intervalMs: 5,
      timeoutMs: 10,
    });

    vi.advanceTimersByTime(5);
    heartbeat.notifyPong(1);
    vi.advanceTimersByTime(10);

    expect(onTimeout).not.toHaveBeenCalled();

    heartbeat.dispose();
    vi.useRealTimers();
  });
});
