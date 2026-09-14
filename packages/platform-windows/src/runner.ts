import {
  createAppSessionEmitter,
  type AppSession,
  type AppSessionState,
  AppNotInstalledError,
  type HarnessPlatformRunnerFactory,
} from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { logger } from '@react-native-harness/tools';
import {
  WindowsPlatformConfigSchema,
  type WindowsPlatformConfigInput,
} from './config.js';
import {
  getPackageFamilyName,
  isProcessRunning,
  launchAppByAumid,
  stopProcess,
} from './pwsh.js';

const log = logger.child('platform-windows');

const APP_EXIT_POLL_INTERVAL_MS = 1000;
const APP_START_POLL_INTERVAL_MS = 400;
const APP_START_POLL_ATTEMPTS = 15;

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

const getWindowsRunner: HarnessPlatformRunnerFactory<
  WindowsPlatformConfigInput,
  HarnessConfig
> = async (config, _harnessConfig, init) => {
  void _harnessConfig;

  const parsedConfig = WindowsPlatformConfigSchema.parse(config);
  const { packageName, appId } = parsedConfig;
  const processName = parsedConfig.processName ?? packageName;

  const packageFamilyName = await getPackageFamilyName(packageName);

  if (packageFamilyName == null) {
    throw new AppNotInstalledError(packageName, 'this machine');
  }

  const aumid = `${packageFamilyName}!${appId}`;
  log.debug('resolved AUMID %s for package %s', aumid, packageName);

  return {
    createAppSession: async (): Promise<AppSession> => {
      // Clean slate: never attach to an instance left over from a previous run.
      await stopProcess(processName);
      await launchAppByAumid(aumid);

      // `explorer.exe` returns before the app is up (and lies about its exit
      // code), so confirm the process actually started. `init.signal` cancels
      // this finite readiness wait; it is not a disposal signal.
      let started = false;
      for (let attempt = 0; attempt < APP_START_POLL_ATTEMPTS; attempt += 1) {
        if (await isProcessRunning(processName)) {
          started = true;
          break;
        }
        await delay(APP_START_POLL_INTERVAL_MS, init.signal);
      }

      if (!started) {
        await stopProcess(processName);
        throw new Error(
          `The Windows app '${processName}' did not start after launching ${aumid}. ` +
            `Deploy it first, e.g. \`npx react-native run-windows --arch x64 --no-launch\`.`
        );
      }

      const emitter = createAppSessionEmitter();
      let state: AppSessionState = { status: 'running' };
      let disposed = false;
      let stopPolling = false;
      let pollDelayTimeout: ReturnType<typeof setTimeout> | null = null;
      let resolvePollDelay: (() => void) | null = null;

      // Unlike a raced delay() loser (which is fine to just discard), this
      // wait is directly `await`ed by pollTask with nothing else racing it,
      // so cancelling it must also resolve the promise immediately —
      // otherwise dispose() blocks on `await pollTask` for up to
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

      const pollTask = (async () => {
        while (!stopPolling) {
          if (!(await isProcessRunning(processName))) {
            if (!disposed && state.status === 'running') {
              state = {
                status: 'exited',
                occurredAt: Date.now(),
                reason: 'process-gone',
              };
              emitter.emit({ type: 'app_exited' });
            }
            return;
          }

          if (stopPolling) {
            return;
          }

          await waitForNextPoll();
        }
      })();

      const session: AppSession = {
        dispose: async () => {
          if (disposed) {
            return;
          }

          disposed = true;
          stopPolling = true;
          cancelPendingPollDelay();
          state = { status: 'disposed', occurredAt: Date.now() };
          emitter.clear();
          await stopProcess(processName);
          await pollTask;
        },
        getState: async () => state,
        getLogs: () => [],
        addListener: emitter.addListener,
        removeListener: emitter.removeListener,
      };

      return session;
    },
    dispose: async () => {
      await stopProcess(processName);
    },
  };
};

export default getWindowsRunner;
