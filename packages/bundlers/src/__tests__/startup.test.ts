import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEmitter } from '@react-native-harness/tools';
import { waitForBundlerBackedAppReady } from '../startup.js';
import type {
  BundlerEvent,
  BundlerInstance,
  PrewarmState,
} from '../types.js';

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

const waitForAbort = (signal: AbortSignal): Promise<never> => {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? createAbortError());
  }

  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason ?? createAbortError());
      },
      { once: true }
    );
  });
};

const createBundlerInstance = (
  overrides: Partial<BundlerInstance> = {}
): BundlerInstance => ({
  events: getEmitter<BundlerEvent>(),
  waitUntilHealthy: vi.fn(async () => ({
    healthy: true,
    status: 'HTTP 200: packager-status:running',
  })),
  prewarm: vi.fn(async () => false),
  getPrewarmState: vi.fn((): PrewarmState => 'failed'),
  isBuildInFlight: vi.fn(() => false),
  dispose: vi.fn(async () => undefined),
  ...overrides,
});

const emitBundleRequestObserved = (
  bundlerInstance: BundlerInstance,
  requestKind: 'app' | 'prewarm',
  platform = 'ios'
) => {
  bundlerInstance.events.emit({
    type: 'entry_requested',
    platform,
    requestKind,
  });
};

const emitBundlerEvent = (
  bundlerInstance: BundlerInstance,
  event: BundlerEvent
) => {
  bundlerInstance.events.emit(event);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForBundlerBackedAppReady', () => {
  it('fails when Metro never becomes healthy', async () => {
    const bundlerInstance = createBundlerInstance({
      waitUntilHealthy: vi.fn(async () => ({
        healthy: false,
        status: 'HTTP 503: packager-status:starting',
      })),
    });
    const startAttempt = vi.fn(async () => undefined);

    await expect(
      waitForBundlerBackedAppReady({
        bundler: bundlerInstance,
        bundlerName: 'Metro',
        platformId: 'ios',
        bundleStartTimeout: 1_000,
        readyTimeout: 2_000,
        maxAppRestarts: 2,
        signal: new AbortController().signal,
        startAttempt,
        waitForReady: async () => undefined,
        waitForCrash: async (signal) => await waitForAbort(signal),
      })
    ).rejects.toMatchObject({
      name: 'StartupStallError',
      code: 'metro_not_ready',
    });

    expect(bundlerInstance.prewarm).not.toHaveBeenCalled();
    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('keeps prewarm as warm-up only and still retries until an app request appears', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance({
      prewarm: vi.fn(async () => true),
      getPrewarmState: vi.fn((): PrewarmState => 'succeeded'),
    });
    const startAttempt = vi.fn(async () => undefined);

    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 1,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady: async (signal) => await waitForAbort(signal),
      waitForCrash: async (signal) => await waitForAbort(signal),
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(promise).rejects.toMatchObject({
      name: 'StartupStallError',
      code: 'bundle_request_not_observed',
      attempts: 2,
      prewarmState: 'succeeded',
    });
    expect(startAttempt).toHaveBeenCalledTimes(2);
  });

  it('completes once the app requests its bundle and reports ready', async () => {
    const bundlerInstance = createBundlerInstance();
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(bundlerInstance, 'app');
    });
    const waitForReady = vi.fn(async () => undefined);

    await waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady,
      waitForCrash: async (signal) => await waitForAbort(signal),
    });

    expect(startAttempt).toHaveBeenCalledTimes(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('does not count startAttempt duration against bundleStartTimeout', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance();
    let resolveStartAttempt!: () => void;
    const startAttempt = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveStartAttempt = resolve;
        })
    );
    const waitForReady = vi.fn(async () => undefined);

    let settled = false;
    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady,
      waitForCrash: async (signal) => await waitForAbort(signal),
    }).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(settled).toBe(false);

    resolveStartAttempt();
    await vi.advanceTimersByTimeAsync(0);
    emitBundleRequestObserved(bundlerInstance, 'app');
    await promise;

    expect(startAttempt).toHaveBeenCalledTimes(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('captures app requests emitted while startAttempt is still running', async () => {
    const bundlerInstance = createBundlerInstance();
    let releaseStartAttempt!: () => void;
    const startAttemptGate = new Promise<void>((resolve) => {
      releaseStartAttempt = resolve;
    });
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(bundlerInstance, 'app');
      await startAttemptGate;
    });
    const waitForReady = vi.fn(async () => undefined);

    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady,
      waitForCrash: async (signal) => await waitForAbort(signal),
    });

    releaseStartAttempt();
    await promise;

    expect(startAttempt).toHaveBeenCalledTimes(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('does not miss ready events emitted before bundle-request handling moves to the ready phase', async () => {
    const bundlerInstance = createBundlerInstance();
    const waitForReady = vi.fn(async () => undefined);

    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(bundlerInstance, 'app');
    });

    await waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady,
      waitForCrash: async (signal) => await waitForAbort(signal),
    });

    expect(startAttempt).toHaveBeenCalledTimes(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('does not count bundle build time against readyTimeout', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance();
    let resolveReady!: () => void;
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(bundlerInstance, 'app');
      setTimeout(() => {
        emitBundlerEvent(bundlerInstance, {
          type: 'build_started',
        } as never);
      }, 0);
    });
    const waitForReady = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveReady = resolve;
        })
    );

    let settled = false;
    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady,
      waitForCrash: async (signal) => await waitForAbort(signal),
    }).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(settled).toBe(false);

    emitBundlerEvent(bundlerInstance, { type: 'build_done' } as never);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(settled).toBe(false);

    resolveReady();
    await promise;

    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('keeps the ready timer paused when a build is already in flight at seed time', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance({
      isBuildInFlight: vi.fn(() => true),
    });
    let resolveReady!: () => void;
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(bundlerInstance, 'app');
    });
    const waitForReady = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveReady = resolve;
        })
    );

    let settled = false;
    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady,
      waitForCrash: async (signal) => await waitForAbort(signal),
    }).finally(() => {
      settled = true;
    });

    // No build_started is emitted: the build was already running when
    // the ready wait began. The seeded state must keep the timer paused.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(settled).toBe(false);

    emitBundlerEvent(bundlerInstance, { type: 'build_done' } as never);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(settled).toBe(false);

    resolveReady();
    await promise;

    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('starts the ready timer once a seeded in-flight build settles', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance({
      isBuildInFlight: vi.fn(() => true),
    });
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(bundlerInstance, 'app');
    });

    let settled = false;
    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady: async (signal) => await waitForAbort(signal),
      waitForCrash: async (signal) => await waitForAbort(signal),
    }).finally(() => {
      settled = true;
    });
    const rejection = expect(promise).rejects.toMatchObject({
      name: 'StartupStallError',
      code: 'ready_not_reported',
      attempts: 1,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(settled).toBe(false);

    emitBundlerEvent(bundlerInstance, { type: 'build_failed' } as never);
    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
    expect(startAttempt).toHaveBeenCalledTimes(1);
  });

  it('fails when the app requests its bundle but never reports ready', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance();
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(bundlerInstance, 'app');
      setTimeout(() => {
        emitBundlerEvent(bundlerInstance, {
          type: 'build_started',
        } as never);
        emitBundlerEvent(bundlerInstance, { type: 'build_done' } as never);
      }, 0);
    });

    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady: async (signal) => await waitForAbort(signal),
      waitForCrash: async (signal) => await waitForAbort(signal),
    });
    const rejection = expect(promise).rejects.toMatchObject({
      name: 'StartupStallError',
      code: 'ready_not_reported',
      attempts: 1,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
    expect(startAttempt).toHaveBeenCalledTimes(1);
  });

  it('starts readyTimeout immediately when the bundler does not emit build events', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance();
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(bundlerInstance, 'app');
    });

    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady: async (signal) => await waitForAbort(signal),
      waitForCrash: async (signal) => await waitForAbort(signal),
    });
    const rejection = expect(promise).rejects.toMatchObject({
      name: 'StartupStallError',
      code: 'ready_not_reported',
      attempts: 1,
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
    expect(startAttempt).toHaveBeenCalledTimes(1);
  });

  it('surfaces crash failures immediately instead of retrying', async () => {
    const bundlerInstance = createBundlerInstance();
    const crashError = new Error('native crash');
    const startAttempt = vi.fn(async () => undefined);

    await expect(
      waitForBundlerBackedAppReady({
        bundler: bundlerInstance,
        bundlerName: 'Metro',
        platformId: 'ios',
        bundleStartTimeout: 1_000,
        readyTimeout: 2_000,
        maxAppRestarts: 2,
        signal: new AbortController().signal,
        startAttempt,
        waitForReady: async (signal) => await waitForAbort(signal),
        waitForCrash: async () => {
          throw crashError;
        },
      })
    ).rejects.toBe(crashError);

    expect(startAttempt).toHaveBeenCalledTimes(1);
  });

  it('stops after maxAppRestarts when no app request is ever observed', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance();
    const startAttempt = vi.fn(async () => undefined);

    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 2,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady: async (signal) => await waitForAbort(signal),
      waitForCrash: async (signal) => await waitForAbort(signal),
    });

    await vi.advanceTimersByTimeAsync(3_000);

    await expect(promise).rejects.toMatchObject({
      name: 'StartupStallError',
      code: 'bundle_request_not_observed',
      attempts: 3,
      prewarmState: 'failed',
    });
    expect(startAttempt).toHaveBeenCalledTimes(3);
  });

  it('does not surface a raw bundle timeout while startAttempt is pending', async () => {
    vi.useFakeTimers();

    const bundlerInstance = createBundlerInstance({
      prewarm: vi.fn(async () => true),
      getPrewarmState: vi.fn((): PrewarmState => 'succeeded'),
    });
    let releaseStartAttempt!: () => void;
    const startAttemptGate = new Promise<void>((resolve) => {
      releaseStartAttempt = resolve;
    });
    const startAttempt = vi.fn(async () => {
      await startAttemptGate;
    });

    const promise = waitForBundlerBackedAppReady({
      bundler: bundlerInstance,
      bundlerName: 'Metro',
      platformId: 'ios',
      bundleStartTimeout: 1_000,
      readyTimeout: 2_000,
      maxAppRestarts: 0,
      signal: new AbortController().signal,
      startAttempt,
      waitForReady: async (signal) => await waitForAbort(signal),
      waitForCrash: async (signal) => await waitForAbort(signal),
    });
    const rejection = expect(promise).rejects.toMatchObject({
      name: 'StartupStallError',
      code: 'bundle_request_not_observed',
      attempts: 1,
      prewarmState: 'succeeded',
    });

    await vi.advanceTimersByTimeAsync(5_000);
    releaseStartAttempt();
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
  });
});
