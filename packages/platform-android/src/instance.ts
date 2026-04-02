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
import {
  isAvdCompatible,
  readAvdConfig,
  resolveAvdCachingEnabled,
} from './avd-config.js';
import { getAdbId } from './adb-id.js';
import * as adb from './adb.js';
import {
  applyHarnessDebugHttpHost,
  clearHarnessDebugHttpHost,
} from './shared-prefs.js';
import { getDeviceName } from './utils.js';
import { createAndroidAppMonitor } from './app-monitor.js';
import { HarnessAppPathError, HarnessEmulatorConfigError } from './errors.js';
import {
  ensureAndroidEmulatorEnvironment,
  getHostAndroidSystemImageArch,
} from './environment.js';
import { isInteractive } from '@react-native-harness/tools';
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

const startAndWaitForBoot = async ({
  emulatorName,
  signal,
  mode,
}: {
  emulatorName: string;
  signal: AbortSignal;
  mode?: Parameters<typeof adb.startEmulator>[1];
}): Promise<string> => {
  await adb.startEmulator(emulatorName, mode);
  return adb.waitForBoot(emulatorName, signal);
};

const recreateAvd = async ({
  emulatorConfig,
}: {
  emulatorConfig: Extract<
    AndroidPlatformConfig['device'],
    { type: 'emulator' }
  >;
}): Promise<void> => {
  if (!emulatorConfig.avd) {
    throw new HarnessEmulatorConfigError(emulatorConfig.name);
  }

  await adb.createAvd({
    name: emulatorConfig.name,
    apiLevel: emulatorConfig.avd.apiLevel,
    profile: emulatorConfig.avd.profile,
    diskSize: emulatorConfig.avd.diskSize,
    heapSize: emulatorConfig.avd.heapSize,
  });
};

const prepareCachedAvd = async ({
  emulatorConfig,
  signal,
}: {
  emulatorConfig: Extract<
    AndroidPlatformConfig['device'],
    { type: 'emulator' }
  >;
  signal: AbortSignal;
}): Promise<string> => {
  const emulatorName = emulatorConfig.name;
  const hostArch = getHostAndroidSystemImageArch();
  const hasExistingAvd = await adb.hasAvd(emulatorName);
  const avdConfig = hasExistingAvd ? await readAvdConfig(emulatorName) : null;
  const compatibility =
    avdConfig == null
      ? { compatible: false as const, reason: 'Missing AVD config.ini.' }
      : isAvdCompatible({
          emulator: emulatorConfig,
          avdConfig,
          hostArch,
        });

  if (!hasExistingAvd || !compatibility.compatible) {
    logger.info(
      hasExistingAvd
        ? 'Recreating incompatible Android emulator %s...'
        : 'Creating Android emulator %s...',
      emulatorName
    );

    if (hasExistingAvd && !compatibility.compatible) {
      androidInstanceLogger.debug(
        'Android AVD %s is not reusable: %s',
        emulatorName,
        compatibility.reason
      );
      await adb.deleteAvd(emulatorName);
    }

    await recreateAvd({ emulatorConfig });

    const generationAdbId = await startAndWaitForBoot({
      emulatorName,
      signal,
      mode: 'clean-snapshot-generation',
    });

    logger.info('Saving Android emulator snapshot for %s...', emulatorName);
    await adb.stopEmulator(generationAdbId);
    await adb.waitForEmulatorDisconnect(generationAdbId, signal);
  } else {
    logger.info('Using cached Android emulator %s...', emulatorName);
  }

  return startAndWaitForBoot({
    emulatorName,
    signal,
    mode: 'snapshot-reuse',
  });
};

export const getAndroidEmulatorPlatformInstance = async (
  config: AndroidPlatformConfig,
  harnessConfig: HarnessConfig,
  init: HarnessPlatformInitOptions
): Promise<HarnessPlatformRunner> => {
  assertAndroidDeviceEmulator(config.device);
  const emulatorConfig = config.device;
  const emulatorName = emulatorConfig.name;
  const avdConfig = emulatorConfig.avd;
  const avdCachingEnabled = resolveAvdCachingEnabled({
    avd: avdConfig,
    isInteractive: isInteractive(),
  });

  let adbId = await getAdbId(emulatorConfig);
  let startedByHarness = false;

  androidInstanceLogger.debug(
    'resolved Android emulator %s with adb id %s',
    emulatorConfig.name,
    adbId ?? 'not-found'
  );

  if (!adbId) {
    if (!avdConfig) {
      throw new HarnessEmulatorConfigError(emulatorConfig.name);
    }

    await ensureAndroidEmulatorEnvironment(avdConfig.apiLevel);

    adbId = avdCachingEnabled
      ? await prepareCachedAvd({
          emulatorConfig,
          signal: init.signal,
        })
      : await (async () => {
          if (!(await adb.hasAvd(emulatorConfig.name))) {
            logger.info('Creating Android emulator %s...', emulatorName);
            androidInstanceLogger.debug(
              'creating Android AVD %s before startup',
              emulatorConfig.name
            );
            await recreateAvd({ emulatorConfig });
          } else {
            logger.info('Using existing Android emulator %s...', emulatorName);
          }

          androidInstanceLogger.debug(
            'starting Android emulator %s',
            emulatorConfig.name
          );
          return startAndWaitForBoot({
            emulatorName: emulatorConfig.name,
            signal: init.signal,
          });
        })();

    startedByHarness = true;

    androidInstanceLogger.debug(
      'Android emulator %s connected as %s',
      emulatorConfig.name,
      adbId
    );
  } else if (emulatorConfig.avd) {
    await ensureAndroidEmulatorEnvironment(emulatorConfig.avd.apiLevel);
  }

  if (!adbId) {
    throw new DeviceNotFoundError(getDeviceName(emulatorConfig));
  }

  androidInstanceLogger.debug(
    'waiting for Android emulator %s to finish booting',
    adbId
  );

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
        logger.info('Shutting down Android emulator %s...', emulatorName);
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
