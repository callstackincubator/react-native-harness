import {
  DeviceNotFoundError,
  AppNotInstalledError,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import {
  AndroidPlatformConfigSchema,
  type AndroidPlatformConfig,
} from './config.js';
import { getAdbId } from './adb-id.js';
import * as adb from './adb.js';
import { getDeviceName } from './utils.js';

const getAndroidRunner = async (
  config: AndroidPlatformConfig
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

  await Promise.all([
    adb.reversePort(adbId, 8081),
    adb.reversePort(adbId, 8080),
    adb.reversePort(adbId, 3001),
  ]);

  return {
    startApp: async () => {
      await adb.startApp(
        adbId,
        parsedConfig.bundleId,
        parsedConfig.activityName
      );
    },
    restartApp: async () => {
      await adb.stopApp(adbId, parsedConfig.bundleId);
      await adb.startApp(
        adbId,
        parsedConfig.bundleId,
        parsedConfig.activityName
      );
    },
    stopApp: async () => {
      await adb.stopApp(adbId, parsedConfig.bundleId);
    },
    dispose: async () => {
      await adb.stopApp(adbId, parsedConfig.bundleId);
    },
  };
};

export default getAndroidRunner;
