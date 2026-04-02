import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEmitter } from '@react-native-harness/tools';
import { waitForMetroBackedAppReady } from '../startup.js';
import type { ReportableEvent } from '../reporter.js';
import type { MetroInstance } from '../types.js';

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

const createMetroInstance = (
  overrides: Partial<MetroInstance> = {}
): MetroInstance => ({
  events: getEmitter<ReportableEvent>(),
  httpServer: {} as never,
  websocketEndpoints: {},
  waitUntilHealthy: vi.fn(async () => 'HTTP 200: packager-status:running'),
  prewarm: vi.fn(async () => false),
  dispose: vi.fn(async () => undefined),
  ...overrides,
});

const emitBundleRequestObserved = (
  metroInstance: MetroInstance,
  requestKind: 'app' | 'prewarm',
  platform = 'ios'
) => {
  metroInstance.events.emit({
    type: 'bundle_request_observed',
    platform,
    requestKind,
    timestamp: new Date().toISOString(),
    url: `/index.bundle?platform=${platform}`,
  });
};

const emitMetroEvent = (
  metroInstance: MetroInstance,
  event: ReportableEvent
) => {
  metroInstance.events.emit(event);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForMetroBackedAppReady', () => {
  it('fails when Metro never becomes healthy', async () => {
    const metroInstance = createMetroInstance({
      waitUntilHealthy: vi.fn(async () => 'HTTP 503: packager-status:starting'),
    });
    const startAttempt = vi.fn(async () => undefined);

    await expect(
      waitForMetroBackedAppReady({
        metro: metroInstance,
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

    expect(metroInstance.prewarm).not.toHaveBeenCalled();
    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('keeps prewarm as warm-up only and still retries until an app request appears', async () => {
    vi.useFakeTimers();

    const metroInstance = createMetroInstance({
      prewarm: vi.fn(async () => true),
    });
    const startAttempt = vi.fn(async () => undefined);

    const promise = waitForMetroBackedAppReady({
      metro: metroInstance,
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
      sawPrewarmRequest: true,
    });
    expect(startAttempt).toHaveBeenCalledTimes(2);
  });

  it('completes once the app requests its bundle and reports ready', async () => {
    const metroInstance = createMetroInstance();
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(metroInstance, 'app');
    });
    const waitForReady = vi.fn(async () => undefined);

    await waitForMetroBackedAppReady({
      metro: metroInstance,
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

    const metroInstance = createMetroInstance();
    let resolveStartAttempt!: () => void;
    const startAttempt = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveStartAttempt = resolve;
        })
    );
    const waitForReady = vi.fn(async () => undefined);

    let settled = false;
    const promise = waitForMetroBackedAppReady({
      metro: metroInstance,
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
    emitBundleRequestObserved(metroInstance, 'app');
    await promise;

    expect(startAttempt).toHaveBeenCalledTimes(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('captures app requests emitted while startAttempt is still running', async () => {
    const metroInstance = createMetroInstance();
    let releaseStartAttempt!: () => void;
    const startAttemptGate = new Promise<void>((resolve) => {
      releaseStartAttempt = resolve;
    });
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(metroInstance, 'app');
      await startAttemptGate;
    });
    const waitForReady = vi.fn(async () => undefined);

    const promise = waitForMetroBackedAppReady({
      metro: metroInstance,
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
    const metroInstance = createMetroInstance();
    const waitForReady = vi.fn(async () => undefined);

    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(metroInstance, 'app');
    });

    await waitForMetroBackedAppReady({
      metro: metroInstance,
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

  it('does not count Metro bundle build time against readyTimeout', async () => {
    vi.useFakeTimers();

    const metroInstance = createMetroInstance();
    let resolveReady!: () => void;
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(metroInstance, 'app');
      setTimeout(() => {
        emitMetroEvent(metroInstance, {
          type: 'bundle_build_started',
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
    const promise = waitForMetroBackedAppReady({
      metro: metroInstance,
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

    emitMetroEvent(metroInstance, { type: 'bundle_build_done' } as never);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(settled).toBe(false);

    resolveReady();
    await promise;

    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('fails when the app requests its bundle but never reports ready', async () => {
    vi.useFakeTimers();

    const metroInstance = createMetroInstance();
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(metroInstance, 'app');
      setTimeout(() => {
        emitMetroEvent(metroInstance, {
          type: 'bundle_build_started',
        } as never);
        emitMetroEvent(metroInstance, { type: 'bundle_build_done' } as never);
      }, 0);
    });

    const promise = waitForMetroBackedAppReady({
      metro: metroInstance,
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

  it('starts readyTimeout immediately when Metro does not emit bundle build events', async () => {
    vi.useFakeTimers();

    const metroInstance = createMetroInstance();
    const startAttempt = vi.fn(async () => {
      emitBundleRequestObserved(metroInstance, 'app');
    });

    const promise = waitForMetroBackedAppReady({
      metro: metroInstance,
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
    const metroInstance = createMetroInstance();
    const crashError = new Error('native crash');
    const startAttempt = vi.fn(async () => undefined);

    await expect(
      waitForMetroBackedAppReady({
        metro: metroInstance,
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

    const metroInstance = createMetroInstance();
    const startAttempt = vi.fn(async () => undefined);

    const promise = waitForMetroBackedAppReady({
      metro: metroInstance,
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
      sawPrewarmRequest: false,
    });
    expect(startAttempt).toHaveBeenCalledTimes(3);
  });

  it('does not surface a raw bundle timeout while startAttempt is pending', async () => {
    vi.useFakeTimers();

    const metroInstance = createMetroInstance({
      prewarm: vi.fn(async () => true),
    });
    let releaseStartAttempt!: () => void;
    const startAttemptGate = new Promise<void>((resolve) => {
      releaseStartAttempt = resolve;
    });
    const startAttempt = vi.fn(async () => {
      await startAttemptGate;
    });

    const promise = waitForMetroBackedAppReady({
      metro: metroInstance,
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
      sawPrewarmRequest: true,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    releaseStartAttempt();
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
  });
});
