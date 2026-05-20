import {
  DeviceNotFoundError,
  AppNotInstalledError,
  type CreateAppMonitorOptions,
  type HarnessPlatformInitOptions,
  HarnessPlatformRunner,
  createNoopAppLifecycleMonitor,
} from '@react-native-harness/platforms';
import { VegaPlatformConfigSchema, type VegaPlatformConfig } from './config.js';
import * as kepler from './kepler.js';

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
    startApp: async () => {
      await kepler.startApp(deviceId, bundleId);
    },
    restartApp: async () => {
      await kepler.stopApp(deviceId, bundleId);
      await kepler.startApp(deviceId, bundleId);
    },
    stopApp: async () => {
      await kepler.stopApp(deviceId, bundleId);
    },
    dispose: async () => {
      await kepler.stopApp(deviceId, bundleId);
    },
    isAppRunning: async () => {
      return await kepler.isAppRunning(deviceId, bundleId);
    },
    createAppMonitor: (options?: CreateAppMonitorOptions) => {
      void options;
      return createNoopAppLifecycleMonitor();
    },
  };
};

export default getVegaRunner;
