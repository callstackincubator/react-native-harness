import {
  AppNotInstalledError,
  DeviceNotFoundError,
  HarnessPlatformInstance,
} from '@react-native-harness/platforms';
import {
  ApplePlatformConfig,
  assertAppleDevicePhysical,
  assertAppleDeviceSimulator,
} from './config.js';
import * as simctl from './xcrun/simctl.js';
import * as devicectl from './xcrun/devicectl.js';
import { getDeviceName } from './utils.js';

export const getAppleSimulatorPlatformInstance = async (
  config: ApplePlatformConfig
): Promise<HarnessPlatformInstance> => {
  assertAppleDeviceSimulator(config.device);

  const udid = await simctl.getSimulatorId(
    config.device.name,
    config.device.systemVersion
  );

  if (!udid) {
    throw new DeviceNotFoundError(getDeviceName(config.device));
  }

  const isInstalled = await simctl.isAppInstalled(udid, config.bundleId);

  if (!isInstalled) {
    throw new AppNotInstalledError(
      config.bundleId,
      getDeviceName(config.device)
    );
  }

  const simulatorStatus = await simctl.getSimulatorStatus(udid);

  if (simulatorStatus !== 'Booted') {
    throw new Error('Simulator is not booted');
  }

  const isAvailable = await simctl.isAppInstalled(udid, config.bundleId);

  if (!isAvailable) {
    throw new AppNotInstalledError(
      config.bundleId,
      getDeviceName(config.device)
    );
  }

  return {
    startApp: async () => {
      await simctl.startApp(udid, config.bundleId);
    },
    restartApp: async () => {
      await simctl.stopApp(udid, config.bundleId);
      await simctl.startApp(udid, config.bundleId);
    },
    stopApp: async () => {
      await simctl.stopApp(udid, config.bundleId);
    },
    dispose: async () => {
      await simctl.stopApp(udid, config.bundleId);
    },
  };
};

export const getApplePhysicalDevicePlatformInstance = async (
  config: ApplePlatformConfig
): Promise<HarnessPlatformInstance> => {
  assertAppleDevicePhysical(config.device);

  const deviceId = await devicectl.getDeviceId(config.device.name);

  if (!deviceId) {
    throw new DeviceNotFoundError(getDeviceName(config.device));
  }

  const isAvailable = await devicectl.isAppInstalled(deviceId, config.bundleId);

  if (!isAvailable) {
    throw new AppNotInstalledError(
      config.bundleId,
      getDeviceName(config.device)
    );
  }

  return {
    startApp: async () => {
      await devicectl.startApp(deviceId, config.bundleId);
    },
    restartApp: async () => {
      await devicectl.stopApp(deviceId, config.bundleId);
      await devicectl.startApp(deviceId, config.bundleId);
    },
    stopApp: async () => {
      await devicectl.stopApp(deviceId, config.bundleId);
    },
    dispose: async () => {
      await devicectl.stopApp(deviceId, config.bundleId);
    },
  };
};
