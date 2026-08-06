import {
  createAppSessionEmitter,
  createBoundedLogBuffer,
  type AppSession,
  type AppSessionState,
  type AppleAppLaunchOptions,
} from '@react-native-harness/platforms';
import {
  delay,
  logger,
  type OwnedProcess,
} from '@react-native-harness/tools';
import type { IosCrashReporter } from './crash-reporter.js';

const iosAppSessionLogger = logger.child('ios-app-session');
const APP_EXIT_POLL_INTERVAL_MS = 1000;
const LAUNCH_FAILURE_SETTLE_MS = 100;

type CreateIosAppSessionOptions = {
  launch: () => OwnedProcess;
  stopApp: () => Promise<void>;
  isAppRunning: () => Promise<boolean>;
  crashReporter?: IosCrashReporter;
};

export const createIosAppSession = async ({
  launch,
  stopApp,
  isAppRunning,
  crashReporter,
}: CreateIosAppSessionOptions): Promise<AppSession> => {
  const emitter = createAppSessionEmitter();
  const logBuffer = createBoundedLogBuffer();
  const ownedLaunchProcess = launch();
  const launchProcess = ownedLaunchProcess.subprocess;
  let state: AppSessionState = { status: 'running' };
  let disposed = false;
  let stopPolling = false;
  let hasObservedRunning = false;
  let pollDelayTimeout: ReturnType<typeof setTimeout> | null = null;
  let resolvePollDelay: (() => void) | null = null;

  // Unlike a raced delay() loser (which is fine to just discard), this wait
  // is directly `await`ed by pollTask with nothing else racing it, so
  // cancelling it must also resolve the promise immediately — otherwise
  // dispose() blocks on Promise.allSettled([...pollTask]) for up to
  // APP_EXIT_POLL_INTERVAL_MS instead of returning right away.
  const waitForNextPoll = () =>
    new Promise<void>((resolve) => {
      resolvePollDelay = () => {
        resolvePollDelay = null;
        pollDelayTimeout = null;
        resolve();
      };

      pollDelayTimeout = setTimeout(() => {
        resolvePollDelay?.();
      }, APP_EXIT_POLL_INTERVAL_MS);
    });

  const cancelPendingPollDelay = () => {
    if (pollDelayTimeout) {
      clearTimeout(pollDelayTimeout);
      pollDelayTimeout = null;
    }

    resolvePollDelay?.();
  };

  const setExited = (reason: 'observed-exit' | 'process-gone') => {
    if (disposed || state.status !== 'running') {
      return;
    }

    state = { status: 'exited', occurredAt: Date.now(), reason };
    emitter.emit({ type: 'app_exited' });
  };

  const logTask = (async () => {
    try {
      for await (const line of launchProcess) {
        if (!disposed) {
          logBuffer.push(String(line));
        }
      }
    } catch (error) {
      if (!disposed) {
        iosAppSessionLogger.debug('iOS app launch log stream stopped', error);
      }
    }
  })();

  const exitTask = (async () => {
    try {
      await launchProcess;
      if (!disposed && !(await isAppRunning())) {
        setExited('observed-exit');
      }
    } catch (error) {
      if (!disposed) {
        logBuffer.push(error instanceof Error ? error.message : String(error));
        setExited('observed-exit');
      }
    }
  })();

  const pollTask = (async () => {
    while (!stopPolling) {
      try {
        if (await isAppRunning()) {
          hasObservedRunning = true;
        } else if (hasObservedRunning) {
          setExited('process-gone');
          return;
        }
      } catch (error) {
        iosAppSessionLogger.debug('iOS app session poll failed', error);
      }

      if (stopPolling) {
        return;
      }

      await waitForNextPoll();
    }
  })();

  const launchFailureSettleTimer = delay(LAUNCH_FAILURE_SETTLE_MS);
  let launchSettled: 'settled' | 'running';
  try {
    launchSettled = await Promise.race([
      launchProcess.then(
        () => 'settled' as const,
        () => 'settled' as const
      ),
      launchFailureSettleTimer.promise.then(() => 'running' as const),
    ]);
  } finally {
    launchFailureSettleTimer.cancel();
  }

  if (launchSettled === 'settled' && !(await isAppRunning())) {
    disposed = true;
    stopPolling = true;
    cancelPendingPollDelay();
    emitter.clear();
    await Promise.allSettled([logTask, exitTask, pollTask]);
    await launchProcess;
    throw new Error('The iOS app launch finished before the app was running.');
  }

  let disposePromise: Promise<void> | undefined;
  const dispose = () =>
    (disposePromise ??= (async () => {
      if (disposed) return;

      disposed = true;
      stopPolling = true;
      cancelPendingPollDelay();
      state = { status: 'disposed', occurredAt: Date.now() };
      emitter.clear();

      await ownedLaunchProcess.dispose();
      await stopApp();
      await Promise.allSettled([logTask, exitTask, pollTask]);
    })());

  return {
    dispose,
    getState: async () => state,
    getLogs: () => logBuffer.getLogs(),
    getCrashDetails: crashReporter?.getCrashDetails,
    addListener: emitter.addListener,
    removeListener: emitter.removeListener,
  };
};

export type CreateIosPlatformSessionOptions = {
  options?: AppleAppLaunchOptions;
};
