import {
  createAppSessionEmitter,
  type AppSession,
  type AppSessionState,
  DeviceNotFoundError,
  AppNotInstalledError,
  type HarnessPlatformInitOptions,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import { VegaPlatformConfigSchema, type VegaPlatformConfig } from './config.js';
import * as kepler from './kepler.js';

const APP_EXIT_POLL_INTERVAL_MS = 1000;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const getVegaRunner = async (
  config: VegaPlatformConfig,
  init?: HarnessPlatformInitOptions
): Promise<HarnessPlatformRunner> => {
  void init;
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

  return {
    createAppSession: async (): Promise<AppSession> => {
      await kepler.stopApp(deviceId, bundleId);
      await kepler.startApp(deviceId, bundleId);

      const emitter = createAppSessionEmitter();
      let state: AppSessionState = { status: 'running' };
      let disposed = false;
      let stopPolling = false;

      const pollTask = (async () => {
        while (!stopPolling) {
          if (!(await kepler.isAppRunning(deviceId, bundleId))) {
            if (!disposed && state.status === 'running') {
              state = { status: 'exited', occurredAt: Date.now(), reason: 'process-gone' };
              emitter.emit({ type: 'app_exited' });
            }
            return;
          }

          await sleep(APP_EXIT_POLL_INTERVAL_MS);
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
          emitter.clear();
          await kepler.stopApp(deviceId, bundleId);
          await pollTask;
        },
        getState: async () => state,
        getLogs: () => [],
        addListener: emitter.addListener,
        removeListener: emitter.removeListener,
      };
    },
    dispose: async () => {
      await kepler.stopApp(deviceId, bundleId);
    },
  };
};

export default getVegaRunner;
