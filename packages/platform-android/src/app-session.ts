import {
  createAppSessionEmitter,
  createBoundedLogBuffer,
  type AppSession,
  type AppSessionState,
  type CrashArtifactWriter,
} from '@react-native-harness/platforms';
import {
  escapeRegExp,
  logger,
  type Subprocess,
} from '@react-native-harness/tools';
import { createAndroidCrashReporter } from './crash-reporter.js';

const androidAppSessionLogger = logger.child('android-app-session');
const APP_EXIT_POLL_INTERVAL_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getLogcatArgs = (appUid: number, fromTime: string) =>
  [
    'logcat',
    '-v',
    'threadtime',
    '-b',
    'crash',
    `--uid=${appUid}`,
    '-T',
    fromTime,
  ] as const;

const getProcessPattern = (bundleId: string) =>
  new RegExp(`Process:\\s*${escapeRegExp(bundleId)},\\s*PID:\\s*(\\d+)`);

const getStartProcPattern = (bundleId: string) =>
  new RegExp(`Start proc (\\d+):${escapeRegExp(bundleId)}(?:/|\\s)`);

const getProcessDiedPattern = (bundleId: string) =>
  new RegExp(
    `Process\\s+${escapeRegExp(
      bundleId
    )}\\s+\\(pid\\s+(\\d+)\\)\\s+has\\s+died`,
    'i'
  );

const getObservedPid = (line: string, bundleId: string): number | undefined => {
  const match =
    line.match(getProcessPattern(bundleId)) ??
    line.match(getStartProcPattern(bundleId)) ??
    line.match(getProcessDiedPattern(bundleId));

  return match?.[1] ? Number(match[1]) : undefined;
};

const isCrashSignal = (line: string, bundleId: string): boolean => {
  return (
    getProcessPattern(bundleId).test(line) ||
    new RegExp(`>>>\\s*${escapeRegExp(bundleId)}\\s*<<<`).test(line) ||
    getProcessDiedPattern(bundleId).test(line) ||
    (line.includes(bundleId) &&
      /fatal|crash|signal 11|signal 6|backtrace/i.test(line))
  );
};

const stopSubprocess = async (child: Subprocess) => {
  try {
    (await child.nodeChildProcess).kill();
  } catch {
    // Ignore termination failures for already-ended background processes.
  }
};

const isExitedState = (
  state: AppSessionState
): state is Extract<AppSessionState, { status: 'exited' }> =>
  state.status === 'exited';

type CreateAndroidAppSessionOptions = {
  appUid: number;
  bundleId: string;
  startApp: () => Promise<void>;
  stopApp: () => Promise<void>;
  getAppPid: () => Promise<number | null>;
  getLogcatTimestamp: () => Promise<string>;
  startLogcat: (args: readonly string[]) => Subprocess;
  getDropboxOutput?: () => Promise<string>;
  getExitInfo?: () => Promise<string>;
  crashArtifactWriter?: CrashArtifactWriter;
};

export const createAndroidAppSession = async ({
  appUid,
  bundleId,
  startApp,
  stopApp,
  getAppPid,
  getLogcatTimestamp,
  startLogcat,
  getDropboxOutput,
  getExitInfo,
  crashArtifactWriter,
}: CreateAndroidAppSessionOptions): Promise<AppSession> => {
  const emitter = createAppSessionEmitter();
  const logBuffer = createBoundedLogBuffer();
  let state: AppSessionState = { status: 'running' };
  let disposed = false;
  let stopPolling = false;
  let hasObservedProcess = false;
  let exitNotification: ReturnType<typeof setTimeout> | null = null;
  let pollDelayTimeout: ReturnType<typeof setTimeout> | null = null;
  let resolvePollDelay: (() => void) | null = null;

  const getCurrentPid = () => ('pid' in state ? state.pid : undefined);

  const setRunning = (pid?: number) => {
    if (disposed || state.status === 'disposed' || state.status === 'exited') {
      return;
    }

    if (pid !== undefined) {
      hasObservedProcess = true;
    }

    state =
      pid === undefined ? { status: 'running' } : { status: 'running', pid };
  };

  const scheduleExitNotification = () => {
    if (exitNotification) {
      return;
    }

    exitNotification = setTimeout(() => {
      exitNotification = null;

      if (!disposed && state.status === 'exited') {
        emitter.emit({ type: 'app_exited' });
      }
    }, 0);
  };

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

  const setExited = (
    reason: 'observed-exit' | 'process-gone',
    pid?: number
  ) => {
    if (disposed || state.status === 'disposed' || state.status === 'exited') {
      return;
    }

    state = {
      status: 'exited',
      occurredAt: Date.now(),
      pid: pid ?? getCurrentPid(),
      reason,
    };
    scheduleExitNotification();
  };

  const setExitedPid = (pid: number) => {
    if (state.status !== 'exited' || state.pid !== undefined) {
      return;
    }

    state = {
      status: 'exited',
      occurredAt: state.occurredAt,
      reason: state.reason,
      pid,
    };
  };

  const logcatTimestamp = await getLogcatTimestamp();
  const sessionStartedAt = Date.now();
  const logcatProcess = startLogcat(getLogcatArgs(appUid, logcatTimestamp));
  const crashReporter = createAndroidCrashReporter({
    bundleId,
    crashArtifactWriter,
    getLogs: () => logBuffer.getLogs(),
    getDropboxOutput,
    getExitInfo,
    minOccurredAt: sessionStartedAt,
  });

  const logTask = (async () => {
    try {
      for await (const rawLine of logcatProcess) {
        const line = String(rawLine);

        if (!disposed) {
          logBuffer.push(line);
        }

        const observedPid = getObservedPid(line, bundleId);

        if (observedPid !== undefined) {
          if (state.status === 'running') {
            setRunning(observedPid);
          } else {
            setExitedPid(observedPid);
          }
        }

        if (state.status === 'running' && isCrashSignal(line, bundleId)) {
          setExited('observed-exit', observedPid);
        }
      }
    } catch (error) {
      if (!disposed) {
        androidAppSessionLogger.debug('Android logcat stream stopped', error);
      }
    }
  })();

  try {
    await startApp();
  } catch (error) {
    disposed = true;
    stopPolling = true;
    emitter.clear();
    await stopSubprocess(logcatProcess);
    await Promise.allSettled([logTask]);
    throw error;
  }

  const pollTask = (async () => {
    await sleep(0);

    while (!stopPolling) {
      if (isExitedState(state)) {
        return;
      }

      try {
        const pid = await getAppPid();

        if (pid != null) {
          setRunning(pid);
        } else if (hasObservedProcess) {
          setExited('process-gone');
          return;
        }
      } catch (error) {
        androidAppSessionLogger.debug('Android app session poll failed', error);
      }

      await waitForNextPoll();
    }
  })();

  return {
    dispose: async () => {
      if (disposed) {
        return;
      }

      disposed = true;
      stopPolling = true;
      state = { status: 'disposed', occurredAt: Date.now() };

      if (exitNotification) {
        clearTimeout(exitNotification);
        exitNotification = null;
      }

      cancelPendingPollDelay();

      emitter.clear();
      await stopSubprocess(logcatProcess);
      await stopApp();
      await Promise.allSettled([logTask, pollTask]);
    },
    getState: async () => state,
    getLogs: () => logBuffer.getLogs(),
    getCrashDetails: crashReporter.getCrashDetails,
    addListener: emitter.addListener,
    removeListener: emitter.removeListener,
  };
};
