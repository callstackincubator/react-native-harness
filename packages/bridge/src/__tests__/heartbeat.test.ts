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

  it('does not time out while suspended for a blocking phase', () => {
    vi.useFakeTimers();

    const sendPing = vi.fn();
    const onTimeout = vi.fn();
    const heartbeat = createHeartbeat({
      sendPing,
      onTimeout,
      intervalMs: 5,
      timeoutMs: 10,
      maxSuspendMs: 1_000,
    });

    // A ping is already in flight when the app announces it is about to block.
    vi.advanceTimersByTime(5);
    expect(sendPing).toHaveBeenCalledTimes(1);

    heartbeat.suspend();
    vi.advanceTimersByTime(500);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(sendPing).toHaveBeenCalledTimes(1);

    // Pinging restarts once the blocking phase is over, and the app gets a
    // full timeout window to answer the next ping.
    heartbeat.resume();
    vi.advanceTimersByTime(5);
    expect(sendPing).toHaveBeenLastCalledWith(2);

    heartbeat.notifyPong(2);
    vi.advanceTimersByTime(5);
    expect(onTimeout).not.toHaveBeenCalled();

    heartbeat.dispose();
    vi.useRealTimers();
  });

  it('resumes on its own if the app never reports the blocking phase ended', () => {
    vi.useFakeTimers();

    const onSuspendExpired = vi.fn();
    const onTimeout = vi.fn();
    const heartbeat = createHeartbeat({
      sendPing: vi.fn(),
      onTimeout,
      onSuspendExpired,
      intervalMs: 5,
      timeoutMs: 10,
      maxSuspendMs: 100,
    });

    heartbeat.suspend();
    expect(heartbeat.suspended).toBe(true);

    vi.advanceTimersByTime(100);
    expect(onSuspendExpired).toHaveBeenCalledTimes(1);
    expect(heartbeat.suspended).toBe(false);

    // Still blocked: liveness detection is back and the session fails as before.
    vi.advanceTimersByTime(15);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    heartbeat.dispose();
    vi.useRealTimers();
  });

  it('ignores suspend and resume after disposal', () => {
    vi.useFakeTimers();

    const sendPing = vi.fn();
    const heartbeat = createHeartbeat({
      sendPing,
      onTimeout: vi.fn(),
      intervalMs: 5,
      timeoutMs: 10,
    });

    heartbeat.dispose();
    heartbeat.suspend();
    heartbeat.resume();
    vi.advanceTimersByTime(50);

    expect(sendPing).not.toHaveBeenCalled();
    expect(heartbeat.suspended).toBe(false);

    vi.useRealTimers();
  });
});
