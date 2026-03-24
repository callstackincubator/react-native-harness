import {
  DeviceNotFoundError,
  AppNotInstalledError,
  CreateAppMonitorOptions,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import {
  AndroidPlatformConfigSchema,
  type AndroidPlatformConfig,
} from './config.js';
import { getAdbId } from './adb-id.js';
import * as adb from './adb.js';
import {
  applyHarnessDebugHttpHost,
  clearHarnessDebugHttpHost,
} from './shared-prefs.js';
import { getDeviceName } from './utils.js';
import { createAndroidAppMonitor } from './app-monitor.js';

const getAndroidRunner = async (
  config: AndroidPlatformConfig,
  harnessConfig: HarnessConfig
): Promise<HarnessPlatformRunner> => {
  const parsedConfig = AndroidPlatformConfigSchema.parse(config);
  const adbId = await getAdbId(parsedConfig.device);

  if (!adbId) {
    throw new DeviceNotFoundError(getDeviceName(parsedConfig.device));
  }

  const isInstalled = await adb.isAppInstalled(adbId, parsedConfig.bundleId);

  if (!isInstalled) {
    throw new AppNotInstalledError(
      parsedConfig.bundleId,
      getDeviceName(parsedConfig.device)
    );
  }

  const metroPort = harnessConfig.metroPort;

  await Promise.all([
    adb.reversePort(adbId, metroPort),
    adb.reversePort(adbId, 8080),
    adb.reversePort(adbId, harnessConfig.webSocketPort),
    adb.setHideErrorDialogs(adbId, true),
    applyHarnessDebugHttpHost(adbId, parsedConfig.bundleId, `localhost:${metroPort}`),
  ]);
  const appUid = await adb.getAppUid(adbId, parsedConfig.bundleId);

  return {
    startApp: async (options) => {
      await adb.startApp(
        adbId,
        parsedConfig.bundleId,
        parsedConfig.activityName,
        (options as typeof parsedConfig.appLaunchOptions | undefined) ??
          parsedConfig.appLaunchOptions
      );
    },
    restartApp: async (options) => {
      await adb.stopApp(adbId, parsedConfig.bundleId);
      await adb.startApp(
        adbId,
        parsedConfig.bundleId,
        parsedConfig.activityName,
        (options as typeof parsedConfig.appLaunchOptions | undefined) ??
          parsedConfig.appLaunchOptions
      );
    },
    stopApp: async () => {
      await adb.stopApp(adbId, parsedConfig.bundleId);
    },
    dispose: async () => {
      await adb.stopApp(adbId, parsedConfig.bundleId);
      await clearHarnessDebugHttpHost(adbId, parsedConfig.bundleId);
      await adb.setHideErrorDialogs(adbId, false);
    },
    isAppRunning: async () => {
      return await adb.isAppRunning(adbId, parsedConfig.bundleId);
    },
    createAppMonitor: (options?: CreateAppMonitorOptions) =>
      createAndroidAppMonitor({
        adbId,
        bundleId: parsedConfig.bundleId,
        appUid,
        crashArtifactWriter: options?.crashArtifactWriter,
      }),
  };
};

export default getAndroidRunner;
