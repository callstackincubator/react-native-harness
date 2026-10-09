import {
  createAppSessionEmitter,
  createBoundedLogBuffer,
  type AppSession,
  type AppSessionState,
} from '@react-native-harness/platforms';
import { logger, type OwnedProcess } from '@react-native-harness/tools';

const log = logger.child('platform-vega');

const APP_EXIT_POLL_INTERVAL_MS = 1000;
// launch-app can return before the process shows up in is-app-running.
const APP_START_GRACE_MS = 10_000;

export type CreateVegaAppSessionOptions = {
  launchApp: () => Promise<void>;
  terminateApp: () => Promise<void>;
  isAppRunning: () => Promise<boolean>;
  startLogStream: () => OwnedProcess;
  stopLogStream: () => Promise<void>;
  startGraceMs?: number;
};

export const createVegaAppSession = async ({
  launchApp,
  terminateApp,
  isAppRunning,
  startLogStream,
  stopLogStream,
  startGraceMs = APP_START_GRACE_MS,
}: CreateVegaAppSessionOptions): Promise<AppSession> => {
  const emitter = createAppSessionEmitter();
  const logBuffer = createBoundedLogBuffer();
  let state: AppSessionState = { status: 'running' };
  let disposed = false;
  let stopPolling = false;
  let pollDelayTimeout: ReturnType<typeof setTimeout> | null = null;
  let resolvePollDelay: (() => void) | null = null;
  let exitNotification: ReturnType<typeof setTimeout> | null = null;

  // Deferred so a caller that attaches a listener right after
  // createAppSession() resolves still receives the event.
  const scheduleExitNotification = () => {
    exitNotification = setTimeout(() => {
      exitNotification = null;

      if (!disposed && state.status === 'exited') {
        emitter.emit({ type: 'app_exited' });
      }
    }, 0);
  };

  // This wait is awaited directly by the poll loop, so cancelling it must
  // also resolve it or dispose() blocks for up to one poll interval.
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

  const ownedLogStream = startLogStream();
  const logTask = (async () => {
    try {
      for await (const line of ownedLogStream.subprocess) {
        logBuffer.push(String(line));
      }
    } catch (error) {
      if (!disposed) {
        log.debug('log stream ended: %s', error);
      }
    }
  })();

  try {
    await launchApp();
  } catch (error) {
    disposed = true;
    await ownedLogStream.dispose();
    await stopLogStream();
    await logTask;
    throw error;
  }

  const launchedAt = Date.now();

  const pollTask = (async () => {
    while (!stopPolling) {
      const running = await isAppRunning();

      if (!running && Date.now() - launchedAt >= startGraceMs) {
        if (!disposed && state.status === 'running') {
          state = {
            status: 'exited',
            occurredAt: Date.now(),
            reason: 'process-gone',
          };
          scheduleExitNotification();
        }
        return;
      }

      if (stopPolling) {
        return;
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
      cancelPendingPollDelay();
      if (exitNotification) {
        clearTimeout(exitNotification);
        exitNotification = null;
      }
      state = { status: 'disposed', occurredAt: Date.now() };
      emitter.clear();
      await ownedLogStream.dispose();
      await stopLogStream();
      await terminateApp();
      await Promise.allSettled([logTask, pollTask]);
    },
    getState: async () => state,
    getLogs: () => logBuffer.getLogs(),
    addListener: emitter.addListener,
    removeListener: emitter.removeListener,
  };
};
