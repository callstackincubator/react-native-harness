import {
  createAppSessionEmitter,
  type AppSession,
  type AppSessionState,
  DeviceNotFoundError,
  AppNotInstalledError,
  type HarnessPlatformRunnerFactory,
} from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { VegaPlatformConfigSchema, type VegaPlatformConfig } from './config.js';
import * as kepler from './kepler.js';

const APP_EXIT_POLL_INTERVAL_MS = 1000;

const getVegaRunner: HarnessPlatformRunnerFactory<
  VegaPlatformConfig,
  HarnessConfig
> = async (config, _harnessConfig, init) => {
  const parsedConfig = VegaPlatformConfigSchema.parse(config);
  const deviceId = parsedConfig.device.deviceId;
  const bundleId = parsedConfig.bundleId;
  const deviceStatus = await kepler.getVegaDeviceStatus(deviceId);

  if (deviceStatus === 'stopped') {
    throw new DeviceNotFoundError(deviceId);
  }

  const isInstalled = await kepler.isAppInstalled(deviceId, bundleId);

  if (!isInstalled) {
    throw new AppNotInstalledError(bundleId, deviceId);
  }

  let currentAppSession: AppSession | null = null;

  // Session-lifetime signal (see HarnessPlatformInitOptions.signal): stop the
  // poll loop and the app on session teardown, in addition to the normal
  // dispose() path.
  const disposeCurrentAppSessionOnAbort = () => void currentAppSession?.dispose();
  if (init.signal.aborted) {
    disposeCurrentAppSessionOnAbort();
  } else {
    init.signal.addEventListener('abort', disposeCurrentAppSessionOnAbort, {
      once: true,
    });
  }

  return {
    createAppSession: async (): Promise<AppSession> => {
      await kepler.stopApp(deviceId, bundleId);
      await kepler.startApp(deviceId, bundleId);

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
          if (!(await kepler.isAppRunning(deviceId, bundleId))) {
            if (!disposed && state.status === 'running') {
              state = { status: 'exited', occurredAt: Date.now(), reason: 'process-gone' };
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
          await kepler.stopApp(deviceId, bundleId);
          await pollTask;
        },
        getState: async () => state,
        getLogs: () => [],
        addListener: emitter.addListener,
        removeListener: emitter.removeListener,
      };

      currentAppSession = session;
      return session;
    },
    dispose: async () => {
      await kepler.stopApp(deviceId, bundleId);
    },
  };
};

export default getVegaRunner;
