import {
  AppNotInstalledError,
  CreateAppMonitorOptions,
  DeviceNotFoundError,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
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
  harnessConfig: HarnessConfig
): Promise<HarnessPlatformRunner> => {
  assertAndroidDeviceEmulator(config.device);

  let adbId = await getAdbId(config.device);
  let startedByHarness = false;

  if (!adbId) {
    const avdConfig = config.device.avd;

    if (!avdConfig) {
      throw new HarnessEmulatorConfigError(config.device.name);
    }

    if (!(await adb.hasAvd(config.device.name))) {
      await adb.createAvd({
        name: config.device.name,
        apiLevel: avdConfig.apiLevel,
        profile: avdConfig.profile,
        diskSize: avdConfig.diskSize,
        heapSize: avdConfig.heapSize,
      });
    }

    await adb.startEmulator(config.device.name);
    adbId = await adb.waitForEmulator(config.device.name);
    startedByHarness = true;
  }

  if (!adbId) {
    throw new DeviceNotFoundError(getDeviceName(config.device));
  }

  await adb.waitForBoot(adbId);

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
