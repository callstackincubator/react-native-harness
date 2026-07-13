import {
  raceAbortSignals,
  withAbortTimeout,
} from '@react-native-harness/tools';
import { StartupStallError } from './errors.js';
import type { ReportableEvent } from './reporter.js';
import type { MetroInstance } from './types.js';

type WaitForBundleRequestOptions = {
  events: MetroInstance['events'];
  platformId: string;
};

type BundleRequestObserver = {
  hasSeenAppRequest: () => boolean;
  waitForAppRequest: () => Promise<void>;
  dispose: () => void;
};

class ReadyTimeoutError extends Error {
  constructor() {
    super(
      'Timed out waiting for the app to become ready after Metro bundling.'
    );
    this.name = 'ReadyTimeoutError';
  }
}

export type WaitForMetroBackedAppReadyOptions = {
  metro: MetroInstance;
  platformId: string;
  bundleStartTimeout: number;
  readyTimeout: number;
  maxAppRestarts: number;
  signal: AbortSignal;
  startAttempt: () => Promise<void>;
  waitForReady: (signal: AbortSignal) => Promise<void>;
  waitForCrash: (signal: AbortSignal) => Promise<never>;
  onAttemptStart?: () => void;
  onAttemptReset?: () => void;
};

class BundleRequestTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for an app-originated Metro bundle request.');
    this.name = 'BundleRequestTimeoutError';
  }
}

const isAbortError = (error: unknown): error is DOMException => {
  return error instanceof DOMException && error.name === 'AbortError';
};

const observeBundleRequest = ({
  events,
  platformId,
}: WaitForBundleRequestOptions): BundleRequestObserver => {
  let sawAppRequest = false;
  let settled = false;

  let resolvePromise!: () => void;
  const appRequestPromise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  const resolveOnce = () => {
    if (settled) {
      return;
    }

    settled = true;
    resolvePromise();
  };

  const onMetroEvent = (event: ReportableEvent) => {
    if (event.type !== 'bundle_request_observed') {
      return;
    }

    // Only the app's own bundle request should resolve this observer; the
    // harness's prewarm fetch also produces a 'bundle_request_observed'
    // event but must not be mistaken for the app launching.
    if (event.requestKind === 'app' && event.platform === platformId) {
      sawAppRequest = true;
      resolveOnce();
    }
  };

  events.addListener(onMetroEvent);

  return {
    hasSeenAppRequest: () => sawAppRequest,
    waitForAppRequest: async () => await appRequestPromise,
    dispose: () => {
      events.removeListener(onMetroEvent);
    },
  };
};

const waitForBundleRequestTimeout = async ({
  timeoutMs,
  signal,
}: {
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<never> => {
  const timeoutSignal = withAbortTimeout(signal, timeoutMs);

  return await new Promise<never>((_, reject) => {
    const cleanup = () => {
      timeoutSignal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();

      if (signal.aborted) {
        reject(
          signal.reason ??
            new DOMException('The operation was aborted', 'AbortError')
        );
        return;
      }

      reject(new BundleRequestTimeoutError());
    };

    timeoutSignal.addEventListener('abort', onAbort, { once: true });
  });
};

const waitForReadyAfterBundleRequest = async (options: {
  events: MetroInstance['events'];
  readyTimeout: number;
  signal: AbortSignal;
  readyPromise: Promise<void>;
  cancelReadyWait: () => void;
  initialBundlingInProgress: boolean;
}): Promise<void> => {
  const {
    events,
    readyTimeout,
    signal,
    readyPromise,
    cancelReadyWait,
    initialBundlingInProgress,
  } = options;

  return await new Promise<void>((resolve, reject) => {
    let bundlingInProgress = initialBundlingInProgress;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const clearReadyTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const cleanup = () => {
      clearReadyTimer();
      events.removeListener(onMetroEvent);
      signal.removeEventListener('abort', onAbort);
    };

    const resolveOnce = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const startReadyTimer = () => {
      clearReadyTimer();
      timeoutId = setTimeout(() => {
        cancelReadyWait();
        rejectOnce(new ReadyTimeoutError());
      }, readyTimeout);
    };

    const onAbort = () => {
      rejectOnce(
        signal.reason ??
          new DOMException('The operation was aborted', 'AbortError')
      );
    };

    const onMetroEvent = (event: ReportableEvent) => {
      if (event.type === 'bundle_build_started') {
        bundlingInProgress = true;
        clearReadyTimer();
        return;
      }

      if (
        bundlingInProgress &&
        (event.type === 'bundle_build_done' ||
          event.type === 'bundle_build_failed')
      ) {
        bundlingInProgress = false;
        startReadyTimer();
      }
    };

    // When a build is already in flight (seeded), keep the ready timer paused
    // until Metro reports the build done or failed.
    if (!bundlingInProgress) {
      startReadyTimer();
    }
    events.addListener(onMetroEvent);
    signal.addEventListener('abort', onAbort, { once: true });

    void readyPromise
      .then(() => {
        resolveOnce();
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (signal.aborted) {
            rejectOnce(
              signal.reason ??
                new DOMException('The operation was aborted', 'AbortError')
            );
          }
          return;
        }

        rejectOnce(error);
      });
  });
};

export const waitForMetroBackedAppReady = async ({
  metro,
  platformId,
  bundleStartTimeout,
  readyTimeout,
  maxAppRestarts,
  signal,
  startAttempt,
  waitForReady,
  waitForCrash,
  onAttemptStart,
  onAttemptReset,
}: WaitForMetroBackedAppReadyOptions): Promise<void> => {
  const lastMetroStatus = await metro.waitUntilHealthy({
    timeoutMs: bundleStartTimeout,
    signal,
  });

  if (!lastMetroStatus.includes('packager-status:running')) {
    throw new StartupStallError(bundleStartTimeout, 1, {
      code: 'metro_not_ready',
      lastMetroStatus,
      prewarmState: metro.getPrewarmState(),
    });
  }

  await metro.prewarm({
    platform: platformId,
    signal,
  });

  const totalAttempts = maxAppRestarts + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    signal.throwIfAborted();
    onAttemptReset?.();
    onAttemptStart?.();

    const attemptController = new AbortController();
    const attemptSignal = raceAbortSignals([signal, attemptController.signal]);
    const crashPromise = waitForCrash(attemptSignal);
    void crashPromise.catch(() => undefined);
    const readyController = new AbortController();
    const readyPromise = waitForReady(
      raceAbortSignals([attemptSignal, readyController.signal])
    );
    void readyPromise.catch(() => undefined);
    const bundleRequestObserver = observeBundleRequest({
      events: metro.events,
      platformId,
    });

    try {
      await startAttempt();

      if (!bundleRequestObserver.hasSeenAppRequest()) {
        await Promise.race([
          bundleRequestObserver.waitForAppRequest(),
          waitForBundleRequestTimeout({
            timeoutMs: bundleStartTimeout,
            signal: attemptSignal,
          }),
          crashPromise,
        ]);
      }

      const readyAfterBundleRequestPromise = waitForReadyAfterBundleRequest({
        events: metro.events,
        readyTimeout,
        signal: attemptSignal,
        readyPromise,
        cancelReadyWait: () => {
          readyController.abort(
            new DOMException('The operation was aborted', 'AbortError')
          );
        },
        // Always false today: prewarm was awaited above, so no build can be
        // in flight here. This seeds the ready-timer pause for the upcoming
        // change that drops that await, where the app's bundle request can
        // coalesce into the still-in-flight prewarm build and Metro emits no
        // fresh bundle_build_started event.
        initialBundlingInProgress: metro.isBuildInFlight(),
      });
      await Promise.race([readyAfterBundleRequestPromise, crashPromise]);
      bundleRequestObserver.dispose();
      attemptController.abort();
      onAttemptReset?.();
      return;
    } catch (error) {
      bundleRequestObserver.dispose();
      readyController.abort(
        new DOMException('The operation was aborted', 'AbortError')
      );
      attemptController.abort();
      onAttemptReset?.();

      if (isAbortError(error) && signal.aborted) {
        throw error;
      }

      if (error instanceof BundleRequestTimeoutError) {
        if (attempt >= totalAttempts) {
          throw new StartupStallError(bundleStartTimeout, totalAttempts, {
            code: 'bundle_request_not_observed',
            lastMetroStatus,
            prewarmState: metro.getPrewarmState(),
          });
        }

        continue;
      }

      if (error instanceof ReadyTimeoutError) {
        throw new StartupStallError(readyTimeout, attempt, {
          code: 'ready_not_reported',
          lastMetroStatus,
          prewarmState: metro.getPrewarmState(),
        });
      }

      if (isAbortError(error)) {
        throw error;
      }

      throw error;
    }
  }

  throw new Error('Metro-backed app startup exited unexpectedly.');
};
