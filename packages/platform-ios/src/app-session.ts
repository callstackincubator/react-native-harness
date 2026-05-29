import {
  createAppSessionEmitter,
  createBoundedLogBuffer,
  type AppSession,
  type AppSessionState,
  type AppleAppLaunchOptions,
} from '@react-native-harness/platforms';
import { logger, type Subprocess } from '@react-native-harness/tools';
import type { IosCrashReporter } from './crash-reporter.js';

const iosAppSessionLogger = logger.child('ios-app-session');
const APP_EXIT_POLL_INTERVAL_MS = 1000;
const LAUNCH_FAILURE_SETTLE_MS = 100;

type CreateIosAppSessionOptions = {
  launch: () => Subprocess;
  stopApp: () => Promise<void>;
  isAppRunning: () => Promise<boolean>;
  crashReporter?: IosCrashReporter;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createIosAppSession = async ({
  launch,
  stopApp,
  isAppRunning,
  crashReporter,
}: CreateIosAppSessionOptions): Promise<AppSession> => {
  const emitter = createAppSessionEmitter();
  const logBuffer = createBoundedLogBuffer();
  const launchProcess = launch();
  let state: AppSessionState = { status: 'running' };
  let disposed = false;
  let stopPolling = false;
  let hasObservedRunning = false;

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

      await sleep(APP_EXIT_POLL_INTERVAL_MS);
    }
  })();

  const launchSettled = await Promise.race([
    launchProcess.then(
      () => 'settled' as const,
      () => 'settled' as const
    ),
    sleep(LAUNCH_FAILURE_SETTLE_MS).then(() => 'running' as const),
  ]);

  if (launchSettled === 'settled' && !(await isAppRunning())) {
    disposed = true;
    stopPolling = true;
    emitter.clear();
    await Promise.allSettled([logTask, exitTask, pollTask]);
    await launchProcess;
    throw new Error('The iOS app launch finished before the app was running.');
  }

  return {
    dispose: async () => {
      if (disposed) {
        return;
      }

      disposed = true;
      stopPolling = true;
      state = { status: 'disposed', occurredAt: Date.now() };
      emitter.clear();

      try {
        (await launchProcess.nodeChildProcess).kill();
      } catch {
        // Ignore termination failures for already-ended launch streams.
      }

      await stopApp();
      await Promise.allSettled([logTask, exitTask, pollTask]);
    },
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
