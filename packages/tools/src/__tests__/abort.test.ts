import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTimeoutSignal,
  raceAbortSignals,
  waitForAbort,
  withAbortTimeout,
} from '../abort.js';

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

const waitForAbortReason = (signal: AbortSignal): Promise<unknown> => {
  if (signal.aborted) {
    return Promise.resolve(signal.reason);
  }

  return new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve(signal.reason);
      },
      { once: true }
    );
  });
};

afterEach(() => {
  vi.useRealTimers();
});

describe('abort helpers', () => {
  it('aborts timeout signals after the configured duration', async () => {
    vi.useFakeTimers();

    const signal = getTimeoutSignal(1_000);
    const abortPromise = waitForAbortReason(signal);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(abortPromise).resolves.toBeInstanceOf(DOMException);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
  });

  it('races abort signals and preserves the first abort reason', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const signal = raceAbortSignals([first.signal, second.signal]);
    const abortPromise = waitForAbortReason(signal);
    const secondReason = new Error('second');

    second.abort(secondReason);
    first.abort(new Error('first'));

    await expect(abortPromise).resolves.toBe(secondReason);
  });

  it('combines parent cancellation and timeout behavior', async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const signal = withAbortTimeout(controller.signal, 1_000);
    const abortPromise = waitForAbortReason(signal);

    controller.abort(createAbortError());
    await expect(abortPromise).resolves.toBeInstanceOf(DOMException);

    const timedSignal = withAbortTimeout(new AbortController().signal, 1_000);
    const timedAbortPromise = waitForAbortReason(timedSignal);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(timedAbortPromise).resolves.toBeInstanceOf(DOMException);
  });
});

describe('waitForAbort', () => {
  it('rejects with the abort reason once the signal aborts', async () => {
    const controller = new AbortController();
    const abortWait = waitForAbort(controller.signal);
    const reason = new Error('teardown');

    controller.abort(reason);

    await expect(abortWait.promise).rejects.toBe(reason);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);

    const abortWait = waitForAbort(controller.signal);

    await expect(abortWait.promise).rejects.toBe(reason);
    // cancel() must be a safe no-op in this path.
    expect(() => abortWait.cancel()).not.toThrow();
  });

  it('removes its abort listener when cancelled after losing a race', async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    // This is the bug class under test: racing waitForAbort against real
    // work and forgetting to cancel the loser leaks one 'abort' listener
    // (and everything its closure retains) per call on a long-lived signal.
    for (let i = 0; i < 5; i += 1) {
      const abortWait = waitForAbort(controller.signal);
      abortWait.promise.catch(() => undefined);
      await Promise.race([Promise.resolve('work'), abortWait.promise]);
      abortWait.cancel();
    }

    expect(addSpy).toHaveBeenCalledTimes(5);
    // Every listener added while losing the race must be removed again —
    // without cancel(), removeSpy would stay at 0 while addSpy grows.
    expect(removeSpy).toHaveBeenCalledTimes(5);
  });
});
