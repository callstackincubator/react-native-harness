import {
  AppNotInstalledError,
  CreateAppMonitorOptions,
  DeviceNotFoundError,
  type HarnessPlatformInitOptions,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { logger } from '@react-native-harness/tools';
import {
  AndroidPlatformConfig,
  assertAndroidDeviceEmulator,
  assertAndroidDevicePhysical,
} from './config.js';
import { getAdbId } from './adb-id.js';
import * as adb from './adb.js';
import {
  applyHarnessDebugHttpHost,
  clearHarnessDebugHttpHost,
} from './shared-prefs.js';
import { getDeviceName } from './utils.js';
import { createAndroidAppMonitor } from './app-monitor.js';
import { HarnessAppPathError, HarnessEmulatorConfigError } from './errors.js';
import fs from 'node:fs';

const androidInstanceLogger = logger.child('android-instance');

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

const configureAndroidRuntime = async (
  adbId: string,
  config: AndroidPlatformConfig,
  harnessConfig: HarnessConfig
): Promise<number> => {
  const metroPort = harnessConfig.metroPort;

  await Promise.all([
    adb.reversePort(adbId, metroPort),
    adb.reversePort(adbId, 8080),
    adb.setHideErrorDialogs(adbId, true),
    applyHarnessDebugHttpHost(adbId, config.bundleId, `localhost:${metroPort}`),
  ]);

  return adb.getAppUid(adbId, config.bundleId);
};

export const getAndroidEmulatorPlatformInstance = async (
  config: AndroidPlatformConfig,
  harnessConfig: HarnessConfig,
  init: HarnessPlatformInitOptions
): Promise<HarnessPlatformRunner> => {
  assertAndroidDeviceEmulator(config.device);

  let adbId = await getAdbId(config.device);
  let startedByHarness = false;

  androidInstanceLogger.debug(
    'resolved Android emulator %s with adb id %s',
    config.device.name,
    adbId ?? 'not-found'
  );

  if (!adbId) {
    const avdConfig = config.device.avd;

    if (!avdConfig) {
      throw new HarnessEmulatorConfigError(config.device.name);
    }

    if (!(await adb.hasAvd(config.device.name))) {
      androidInstanceLogger.debug(
        'creating Android AVD %s before startup',
        config.device.name
      );
      await adb.createAvd({
        name: config.device.name,
        apiLevel: avdConfig.apiLevel,
        profile: avdConfig.profile,
        diskSize: avdConfig.diskSize,
        heapSize: avdConfig.heapSize,
      });
    }

    androidInstanceLogger.debug(
      'starting Android emulator %s',
      config.device.name
    );
    await adb.startEmulator(config.device.name);
    adbId = await adb.waitForEmulator(config.device.name, init.signal);
    startedByHarness = true;

    androidInstanceLogger.debug(
      'Android emulator %s connected as %s',
      config.device.name,
      adbId
    );
  }

  if (!adbId) {
    throw new DeviceNotFoundError(getDeviceName(config.device));
  }

  androidInstanceLogger.debug(
    'waiting for Android emulator %s to finish booting',
    adbId
  );
  await adb.waitForBoot(adbId, init.signal);

  const isInstalled = await adb.isAppInstalled(adbId, config.bundleId);

  if (!isInstalled) {
    const appPath = getHarnessAppPath();
    await adb.installApp(adbId, appPath);
  }

  const appUid = await configureAndroidRuntime(adbId, config, harnessConfig);

  return {
    startApp: async (options) => {
      await adb.startApp(
        adbId,
        config.bundleId,
        config.activityName,
        (options as typeof config.appLaunchOptions | undefined) ??
          config.appLaunchOptions
      );
    },
    restartApp: async (options) => {
      await adb.stopApp(adbId, config.bundleId);
      await adb.startApp(
        adbId,
        config.bundleId,
        config.activityName,
        (options as typeof config.appLaunchOptions | undefined) ??
          config.appLaunchOptions
      );
    },
    stopApp: async () => {
      await adb.stopApp(adbId, config.bundleId);
    },
    dispose: async () => {
      await adb.stopApp(adbId, config.bundleId);
      await clearHarnessDebugHttpHost(adbId, config.bundleId);
      await adb.setHideErrorDialogs(adbId, false);

      if (startedByHarness) {
        await adb.stopEmulator(adbId);
      }
    },
    isAppRunning: async () => {
      return await adb.isAppRunning(adbId, config.bundleId);
    },
    createAppMonitor: (options?: CreateAppMonitorOptions) =>
      createAndroidAppMonitor({
        adbId,
        bundleId: config.bundleId,
        appUid,
        crashArtifactWriter: options?.crashArtifactWriter,
      }),
  };
};

export const getAndroidPhysicalDevicePlatformInstance = async (
  config: AndroidPlatformConfig,
  harnessConfig: HarnessConfig
): Promise<HarnessPlatformRunner> => {
  assertAndroidDevicePhysical(config.device);

  const adbId = await getAdbId(config.device);

  if (!adbId) {
    throw new DeviceNotFoundError(getDeviceName(config.device));
  }

  const isInstalled = await adb.isAppInstalled(adbId, config.bundleId);

  if (!isInstalled) {
    throw new AppNotInstalledError(
      config.bundleId,
      getDeviceName(config.device)
    );
  }

  const appUid = await configureAndroidRuntime(adbId, config, harnessConfig);

  return {
    startApp: async (options) => {
      await adb.startApp(
        adbId,
        config.bundleId,
        config.activityName,
        (options as typeof config.appLaunchOptions | undefined) ??
          config.appLaunchOptions
      );
    },
    restartApp: async (options) => {
      await adb.stopApp(adbId, config.bundleId);
      await adb.startApp(
        adbId,
        config.bundleId,
        config.activityName,
        (options as typeof config.appLaunchOptions | undefined) ??
          config.appLaunchOptions
      );
    },
    stopApp: async () => {
      await adb.stopApp(adbId, config.bundleId);
    },
    dispose: async () => {
      await adb.stopApp(adbId, config.bundleId);
      await clearHarnessDebugHttpHost(adbId, config.bundleId);
      await adb.setHideErrorDialogs(adbId, false);
    },
    isAppRunning: async () => {
      return await adb.isAppRunning(adbId, config.bundleId);
    },
    createAppMonitor: (options?: CreateAppMonitorOptions) =>
      createAndroidAppMonitor({
        adbId,
        bundleId: config.bundleId,
        appUid,
        crashArtifactWriter: options?.crashArtifactWriter,
      }),
  };
};
