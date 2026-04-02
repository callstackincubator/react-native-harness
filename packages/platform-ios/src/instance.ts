import {
  AppNotInstalledError,
  CreateAppMonitorOptions,
  DeviceNotFoundError,
  type HarnessPlatformInitOptions,
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
import { HarnessAppPathError } from './errors.js';
import { logger } from '@react-native-harness/tools';
import fs from 'node:fs';

const iosInstanceLogger = logger.child('ios-instance');

const getHarnessAppPath = (): string => {
  const appPath = process.env.HARNESS_APP_PATH;

  if (!appPath) {
    throw new HarnessAppPathError('missing');
  }

  if (!fs.existsSync(appPath)) {
    throw new HarnessAppPathError('invalid', appPath);
  }

  return appPath;
};

export const getAppleSimulatorPlatformInstance = async (
  config: ApplePlatformConfig,
  harnessConfig: HarnessConfig,
  init: HarnessPlatformInitOptions
): Promise<HarnessPlatformRunner> => {
  assertAppleDeviceSimulator(config.device);

  const udid = await simctl.getSimulatorId(
    config.device.name,
    config.device.systemVersion
  );

  if (!udid) {
    throw new DeviceNotFoundError(getDeviceName(config.device));
  }

  const simulatorStatus = await simctl.getSimulatorStatus(udid);
  let startedByHarness = false;

  iosInstanceLogger.debug(
    'resolved iOS simulator %s with status %s',
    udid,
    simulatorStatus
  );

  if (
    !simctl.isBootedSimulatorStatus(simulatorStatus) &&
    !simctl.isBootingSimulatorStatus(simulatorStatus)
  ) {
    logger.info('Booting iOS simulator %s...', config.device.name);
    iosInstanceLogger.debug(
      'booting iOS simulator %s from status %s',
      udid,
      simulatorStatus
    );
    await simctl.bootSimulator(udid);
    startedByHarness = true;
  }

  if (simctl.isBootedSimulatorStatus(simulatorStatus)) {
    logger.info('Using booted iOS simulator %s...', config.device.name);
  } else if (simctl.isBootingSimulatorStatus(simulatorStatus)) {
    logger.info(
      'Waiting for iOS simulator %s to finish booting...',
      config.device.name
    );
  }

  if (!simctl.isBootedSimulatorStatus(simulatorStatus)) {
    iosInstanceLogger.debug(
      'waiting for iOS simulator %s to finish booting',
      udid
    );
    await simctl.waitForBoot(udid, init.signal);
  }

  const isInstalled = await simctl.isAppInstalled(udid, config.bundleId);

  if (!isInstalled) {
    const appPath = getHarnessAppPath();
    await simctl.installApp(udid, appPath);
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

      if (startedByHarness) {
        logger.info('Shutting down iOS simulator %s...', config.device.name);
        await simctl.shutdownSimulator(udid);
      }
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
