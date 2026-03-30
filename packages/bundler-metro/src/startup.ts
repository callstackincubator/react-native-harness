import { raceAbortSignals, withAbortTimeout } from '@react-native-harness/tools';
import { StartupStallError } from './errors.js';
import type { ReportableEvent } from './reporter.js';
import type { MetroInstance } from './types.js';

type WaitForBundleRequestOptions = {
  events: MetroInstance['events'];
  platformId: string;
  timeoutMs: number;
  signal: AbortSignal;
  initialPrewarmSeen?: boolean;
};

type BundleRequestObservation = {
  sawPrewarmRequest: boolean;
};

class ReadyTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the app to become ready after Metro bundling.');
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
  constructor(public readonly sawPrewarmRequest: boolean) {
    super('Timed out waiting for an app-originated Metro bundle request.');
    this.name = 'BundleRequestTimeoutError';
  }
}

const isAbortError = (error: unknown): error is DOMException => {
  return error instanceof DOMException && error.name === 'AbortError';
};

const waitForBundleRequest = async ({
  events,
  platformId,
  timeoutMs,
  signal,
  initialPrewarmSeen = false,
}: WaitForBundleRequestOptions): Promise<BundleRequestObservation> => {
  let sawPrewarmRequest = initialPrewarmSeen;

  return await new Promise<BundleRequestObservation>((resolve, reject) => {
    const requestSignal = withAbortTimeout(signal, timeoutMs);

    const cleanup = () => {
      events.removeListener(onMetroEvent);
      requestSignal.removeEventListener('abort', onAbort);
    };

    const resolveOnce = () => {
      cleanup();
      resolve({
        sawPrewarmRequest,
      });
    };

    const rejectOnce = (error: unknown) => {
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      if (signal.aborted) {
        rejectOnce(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
        return;
      }

      rejectOnce(new BundleRequestTimeoutError(sawPrewarmRequest));
    };

    const onMetroEvent = (event: ReportableEvent) => {
      if (event.type !== 'bundle_request_observed') {
        return;
      }

      if (event.requestKind === 'prewarm') {
        sawPrewarmRequest = true;
        return;
      }

      if (event.requestKind === 'app' && event.platform === platformId) {
        resolveOnce();
      }
    };

    events.addListener(onMetroEvent);
    requestSignal.addEventListener('abort', onAbort, { once: true });
  });
};

const waitForReadyAfterBundleRequest = async (options: {
  events: MetroInstance['events'];
  readyTimeout: number;
  signal: AbortSignal;
  readyPromise: Promise<void>;
  cancelReadyWait: () => void;
}): Promise<void> => {
  const { events, readyTimeout, signal, readyPromise, cancelReadyWait } = options;

  return await new Promise<void>((resolve, reject) => {
    let bundlingInProgress = false;
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
      rejectOnce(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
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

    startReadyTimer();
    events.addListener(onMetroEvent);
    signal.addEventListener('abort', onAbort, { once: true });

    void readyPromise
      .then(() => {
        resolveOnce();
      })
      .catch((error) => {
        if (
          error instanceof DOMException &&
          error.name === 'AbortError'
        ) {
          if (signal.aborted) {
            rejectOnce(
              signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
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
    });
  }

  const prewarmCompleted = await metro.prewarm({
    platform: platformId,
    signal,
  });

  let sawPrewarmRequest = prewarmCompleted;
  const totalAttempts = maxAppRestarts + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    signal.throwIfAborted();
    onAttemptReset?.();
    onAttemptStart?.();

    const attemptController = new AbortController();
    const attemptSignal = raceAbortSignals([signal, attemptController.signal]);
    const crashPromise = waitForCrash(attemptSignal);
    const readyController = new AbortController();
    const readyPromise = waitForReady(
      raceAbortSignals([attemptSignal, readyController.signal])
    );

    try {
      const bundleRequestPromise = waitForBundleRequest({
        events: metro.events,
        platformId,
        timeoutMs: bundleStartTimeout,
        signal: attemptSignal,
        initialPrewarmSeen: sawPrewarmRequest,
      });

      await startAttempt();

      const bundleRequestResult = await Promise.race([
        bundleRequestPromise,
        crashPromise,
      ]);
      sawPrewarmRequest = bundleRequestResult.sawPrewarmRequest;

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
      });
      await Promise.race([readyAfterBundleRequestPromise, crashPromise]);
      attemptController.abort();
      onAttemptReset?.();
      return;
    } catch (error) {
      readyController.abort(
        new DOMException('The operation was aborted', 'AbortError')
      );
      attemptController.abort();
      onAttemptReset?.();

      if (isAbortError(error) && signal.aborted) {
        throw error;
      }

      if (error instanceof BundleRequestTimeoutError) {
        sawPrewarmRequest = error.sawPrewarmRequest;

        if (attempt >= totalAttempts) {
          throw new StartupStallError(bundleStartTimeout, totalAttempts, {
            code: 'bundle_request_not_observed',
            lastMetroStatus,
            sawPrewarmRequest,
          });
        }

        continue;
      }

      if (error instanceof ReadyTimeoutError) {
        throw new StartupStallError(readyTimeout, attempt, {
          code: 'ready_not_reported',
          lastMetroStatus,
          sawPrewarmRequest,
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
