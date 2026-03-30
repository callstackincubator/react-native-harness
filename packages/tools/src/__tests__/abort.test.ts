import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTimeoutSignal, raceAbortSignals, withAbortTimeout } from '../abort.js';

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

const waitForAbort = (signal: AbortSignal): Promise<unknown> => {
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
    const abortPromise = waitForAbort(signal);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(abortPromise).resolves.toBeInstanceOf(DOMException);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
  });

  it('races abort signals and preserves the first abort reason', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const signal = raceAbortSignals([first.signal, second.signal]);
    const abortPromise = waitForAbort(signal);
    const secondReason = new Error('second');

    second.abort(secondReason);
    first.abort(new Error('first'));

    await expect(abortPromise).resolves.toBe(secondReason);
  });

  it('combines parent cancellation and timeout behavior', async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const signal = withAbortTimeout(controller.signal, 1_000);
    const abortPromise = waitForAbort(signal);

    controller.abort(createAbortError());
    await expect(abortPromise).resolves.toBeInstanceOf(DOMException);

    const timedSignal = withAbortTimeout(new AbortController().signal, 1_000);
    const timedAbortPromise = waitForAbort(timedSignal);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(timedAbortPromise).resolves.toBeInstanceOf(DOMException);
  });
});
