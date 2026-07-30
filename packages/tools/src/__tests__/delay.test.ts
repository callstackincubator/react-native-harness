import { afterEach, describe, expect, it, vi } from 'vitest';
import { delay } from '../delay.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('delay', () => {
  it('resolves after the requested duration', async () => {
    vi.useFakeTimers();

    const pending = delay(1_000);
    let resolved = false;
    void pending.promise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it('clears the underlying timer when cancelled, leaving no pending timer', async () => {
    vi.useFakeTimers();

    // This is the bug class under test: racing delay() against real work
    // and forgetting to cancel the loser leaves a ref'd Timeout alive in
    // the event loop until it eventually fires, which keeps a process from
    // exiting even after the work it was racing against has already won.
    const pending = delay(30_000);
    const work = Promise.resolve('winner');

    const result = await Promise.race([
      work,
      pending.promise.then(() => 'timedOut' as const),
    ]);
    pending.cancel();

    expect(result).toBe('winner');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is a no-op to cancel a delay that has already fired', async () => {
    vi.useFakeTimers();

    const pending = delay(100);
    await vi.advanceTimersByTimeAsync(100);
    await pending.promise;

    expect(() => pending.cancel()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
