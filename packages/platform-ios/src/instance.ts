import {
  AppNotInstalledError,
  CreateAppMonitorOptions,
  DeviceNotFoundError,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import {
  ApplePlatformConfig,
  assertAppleDevicePhysical,
  assertAppleDeviceSimulator,
} from './config.js';
import * as simctl from './xcrun/simctl.js';
import * as devicectl from './xcrun/devicectl.js';
import { getDeviceName } from './utils.js';
import {
  createIosDeviceAppMonitor,
  createIosSimulatorAppMonitor,
} from './app-monitor.js';
import { assertLibimobiledeviceInstalled } from './libimobiledevice.js';

export const getAppleSimulatorPlatformInstance = async (
  config: ApplePlatformConfig,
  harnessConfig: HarnessConfig
): Promise<HarnessPlatformRunner> => {
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

  await simctl.applyHarnessJsLocationOverride(
    udid,
    config.bundleId,
    `localhost:${harnessConfig.metroPort}`
  );

  return {
    startApp: async (options) => {
      await simctl.startApp(
        udid,
        config.bundleId,
        (options as typeof config.appLaunchOptions | undefined) ??
          config.appLaunchOptions
      );
    },
    restartApp: async (options) => {
      await simctl.stopApp(udid, config.bundleId);
      await simctl.startApp(
        udid,
        config.bundleId,
        (options as typeof config.appLaunchOptions | undefined) ??
          config.appLaunchOptions
      );
    },
    stopApp: async () => {
      await simctl.stopApp(udid, config.bundleId);
    },
    dispose: async () => {
      await simctl.stopApp(udid, config.bundleId);
      await simctl.clearHarnessJsLocationOverride(udid, config.bundleId);
    },
    isAppRunning: async () => {
      return await simctl.isAppRunning(udid, config.bundleId);
    },
    createAppMonitor: (options?: CreateAppMonitorOptions) =>
      createIosSimulatorAppMonitor({
        udid,
        bundleId: config.bundleId,
        crashArtifactWriter: options?.crashArtifactWriter,
      }),
  };
};

export const getApplePhysicalDevicePlatformInstance = async (
  config: ApplePlatformConfig,
  harnessConfig: HarnessConfig
): Promise<HarnessPlatformRunner> => {
  assertAppleDevicePhysical(config.device);
  await assertLibimobiledeviceInstalled();

  if (harnessConfig.metroPort !== DEFAULT_METRO_PORT) {
    throw new Error(
      `Custom Metro port ${harnessConfig.metroPort} is not supported on physical iOS devices. Physical devices always connect to port ${DEFAULT_METRO_PORT}.`
    );
  }

  const device = await devicectl.getDevice(config.device.name);

  if (!device) {
    throw new DeviceNotFoundError(getDeviceName(config.device));
  }

  const deviceId = device.identifier;
  const hardwareUdid = device.hardwareProperties.udid;

  const isAvailable = await devicectl.isAppInstalled(deviceId, config.bundleId);

  if (!isAvailable) {
    throw new AppNotInstalledError(
      config.bundleId,
      getDeviceName(config.device)
    );
  }

  return {
    startApp: async (options) => {
      await devicectl.startApp(
        deviceId,
        config.bundleId,
        (options as typeof config.appLaunchOptions | undefined) ??
          config.appLaunchOptions
      );
    },
    restartApp: async (options) => {
      await devicectl.stopApp(deviceId, config.bundleId);
      await devicectl.startApp(
        deviceId,
        config.bundleId,
        (options as typeof config.appLaunchOptions | undefined) ??
          config.appLaunchOptions
      );
    },
    stopApp: async () => {
      await devicectl.stopApp(deviceId, config.bundleId);
    },
    dispose: async () => {
      await devicectl.stopApp(deviceId, config.bundleId);
    },
    isAppRunning: async () => {
      return await devicectl.isAppRunning(deviceId, config.bundleId);
    },
    createAppMonitor: (options?: CreateAppMonitorOptions) =>
      createIosDeviceAppMonitor({
        deviceId,
        libimobiledeviceUdid: hardwareUdid,
        bundleId: config.bundleId,
        crashArtifactWriter: options?.crashArtifactWriter,
      }),
  };
};
