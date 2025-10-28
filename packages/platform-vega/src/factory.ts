import {
  DeviceNotFoundError,
  AppNotInstalledError,
  HarnessPlatform,
} from '@react-native-harness/platforms';
import {
  VegaPlatformConfigSchema,
  type VegaPlatformConfig,
  type VegaEmulator,
} from './config.js';
import * as kepler from './kepler.js';

export const vegaEmulator = (deviceId: string): VegaEmulator => ({
  type: 'emulator',
  deviceId,
});

export const vegaPlatform = (config: VegaPlatformConfig): HarnessPlatform => ({
  name: config.name,
  getInstance: async () => {
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
    };
  },
});
