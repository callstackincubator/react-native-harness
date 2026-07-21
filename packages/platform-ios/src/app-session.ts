import fs from 'node:fs';
import path from 'node:path';
import {
  createAppSessionEmitter,
  createBoundedLogBuffer,
  type AppSession,
  type AppSessionState,
  type AppleAppLaunchOptions,
} from '@react-native-harness/platforms';
import {
  createHarnessArtifactDirectory,
  logger,
  terminate,
  type Subprocess,
} from '@react-native-harness/tools';
import type { IosCrashReporter } from './crash-reporter.js';

const iosAppSessionLogger = logger.child('ios-app-session');
const APP_EXIT_POLL_INTERVAL_MS = 1000;
const LAUNCH_FAILURE_SETTLE_MS = 100;
const LAUNCH_PROCESS_FORCE_KILL_AFTER_MS = 2000;

type CreateIosAppSessionOptions = {
  launch: () => Subprocess;
  stopApp: () => Promise<void>;
  isAppRunning: () => Promise<boolean>;
  crashReporter?: IosCrashReporter;
  /**
   * Session-lifetime abort signal (see HarnessPlatformInitOptions.signal).
   * Terminates the `--console` launch process on session teardown, in
   * addition to the normal dispose() path.
   */
  signal?: AbortSignal;
  /**
   * DIAGNOSTIC: optional os_log stream (e.g. `simctl spawn <udid> log stream`)
   * whose output is persisted alongside the console log. `--console` only
   * captures the app's stdout/stderr; the native `[HarnessUI]` RCTLog
   * breadcrumbs go to the unified log, so we capture them separately.
   */
  streamSystemLogs?: () => Subprocess;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createIosAppSession = async ({
  launch,
  stopApp,
  isAppRunning,
  crashReporter,
  signal,
  streamSystemLogs,
}: CreateIosAppSessionOptions): Promise<AppSession> => {
  const emitter = createAppSessionEmitter();
  const logBuffer = createBoundedLogBuffer();
  const launchProcess = launch();
  let state: AppSessionState = { status: 'running' };
  let disposed = false;
  let stopPolling = false;
  let hasObservedRunning = false;

  // DIAGNOSTIC: persist the `--console` app stdout/stderr (which includes the
  // native `[HarnessUI]` RCTLog breadcrumbs) to a file under `.harness/logs`
  // so it is uploaded as a CI artifact. See app-console-persistence diagnosis.
  let consoleLogStream: fs.WriteStream | null = null;
  let osLogStream: fs.WriteStream | null = null;
  try {
    const consoleArtifacts = createHarnessArtifactDirectory({
      artifactType: 'logs',
      platformId: 'ios',
      runnerName: 'app-console-simulator',
    });
    consoleLogStream = fs.createWriteStream(
      path.join(consoleArtifacts.directoryPath, 'app-console.log'),
      { flags: 'a' }
    );
    if (streamSystemLogs) {
      osLogStream = fs.createWriteStream(
        path.join(consoleArtifacts.directoryPath, 'app-oslog.log'),
        { flags: 'a' }
      );
    }
    iosAppSessionLogger.info(
      'Saving iOS app console logs to %s',
      consoleArtifacts.directoryPath
    );
  } catch (error) {
    iosAppSessionLogger.debug('Failed to open iOS app console log file', error);
  }

  const systemLogProcess = streamSystemLogs?.();
  const systemLogTask = systemLogProcess
    ? (async () => {
        try {
          for await (const line of systemLogProcess) {
            if (!disposed) {
              osLogStream?.write(`${String(line)}\n`);
            }
          }
        } catch (error) {
          if (!disposed) {
            iosAppSessionLogger.debug('iOS os_log stream stopped', error);
          }
        } finally {
          osLogStream?.end();
        }
      })()
    : null;

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
          const text = String(line);
          logBuffer.push(text);
          consoleLogStream?.write(`${text}\n`);
        }
      }
    } catch (error) {
      if (!disposed) {
        iosAppSessionLogger.debug('iOS app launch log stream stopped', error);
      }
    } finally {
      consoleLogStream?.end();
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
    if (systemLogProcess) {
      await terminate(systemLogProcess, {
        forceAfterMs: LAUNCH_PROCESS_FORCE_KILL_AFTER_MS,
      });
    }
    await Promise.allSettled([logTask, exitTask, pollTask, systemLogTask]);
    await launchProcess;
    throw new Error('The iOS app launch finished before the app was running.');
  }

  const dispose = async () => {
    if (disposed) {
      return;
    }

    disposed = true;
    stopPolling = true;
    state = { status: 'disposed', occurredAt: Date.now() };
    emitter.clear();

    await terminate(launchProcess, {
      forceAfterMs: LAUNCH_PROCESS_FORCE_KILL_AFTER_MS,
    });
    if (systemLogProcess) {
      await terminate(systemLogProcess, {
        forceAfterMs: LAUNCH_PROCESS_FORCE_KILL_AFTER_MS,
      });
    }
    await stopApp();
    await Promise.allSettled([logTask, exitTask, pollTask, systemLogTask]);
  };

  if (signal?.aborted) {
    void dispose();
  } else {
    signal?.addEventListener('abort', () => void dispose(), { once: true });
  }

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
