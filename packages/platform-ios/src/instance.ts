import {
  AppNotInstalledError,
  type CollectNativeCoverageOptions,
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
import { HarnessAppPathError } from './errors.js';
import { logger } from '@react-native-harness/tools';
import fs from 'node:fs';
import { createXCTestAgentController } from './xctest-agent.js';
import { createPermissionPromptAutoAcceptCapability } from './xctest-agent-capabilities.js';
import {
  collectNativeCoverage,
  cleanProfrawDir,
} from './coverage-collector.js';
import { createIosAppSession } from './app-session.js';
import {
  createIosCrashReporter,
  getIosProcessNames,
} from './crash-reporter.js';

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
  const permissionsEnabled = harnessConfig.permissions ?? false;

  if (harnessConfig.coverage?.native?.ios?.pods?.length) {
    cleanProfrawDir();
  }

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

  const xctestAgent = permissionsEnabled
    ? createXCTestAgentController({
        appBundleId: config.bundleId,
        target: {
          kind: 'simulator',
          id: udid,
        },
        capabilities: [createPermissionPromptAutoAcceptCapability()],
      })
    : null;

  let agentStarted = false;
  try {
    await xctestAgent?.ensureStarted();
    agentStarted = true;
  } finally {
    if (!agentStarted) {
      await xctestAgent?.dispose();
      await simctl.clearHarnessJsLocationOverride(udid, config.bundleId);
      if (startedByHarness) {
        await simctl.shutdownSimulator(udid);
      }
    }
  }

  return {
    createAppSession: async (options) => {
      await simctl.stopApp(udid, config.bundleId);
      const launchOptions =
        (options as typeof config.appLaunchOptions | undefined) ??
        config.appLaunchOptions;
      const appInfo = await simctl.getAppInfo(udid, config.bundleId);
      const processNames = getIosProcessNames(
        appInfo?.CFBundleExecutable,
        appInfo?.CFBundleName,
        appInfo?.CFBundleDisplayName,
        config.bundleId
      );
      const crashReporter = createIosCrashReporter({
        targetId: udid,
        targetType: 'simulator',
        bundleId: config.bundleId,
        processNames,
        minOccurredAt: Date.now(),
        crashArtifactWriter: init.crashArtifactWriter,
      });

      return await createIosAppSession({
        launch: () =>
          simctl.launchAppProcess(udid, config.bundleId, launchOptions),
        stopApp: () => simctl.stopApp(udid, config.bundleId),
        isAppRunning: () => simctl.isAppRunning(udid, config.bundleId),
        crashReporter,
      });
    },
    dispose: async () => {
      await xctestAgent?.dispose();
      await simctl.stopApp(udid, config.bundleId);
      await simctl.clearHarnessJsLocationOverride(udid, config.bundleId);

      if (startedByHarness) {
        logger.info('Shutting down iOS simulator %s...', config.device.name);
        await simctl.shutdownSimulator(udid);
      }
    },
    collectNativeCoverage: async (options: CollectNativeCoverageOptions) => {
      return await collectNativeCoverage({
        udid,
        bundleId: config.bundleId,
        pods: options.pods,
        outputDir: options.outputDir,
      });
    },
  };
};

export const getApplePhysicalDevicePlatformInstance = async (
  config: ApplePlatformConfig,
  harnessConfig: HarnessConfig,
  init?: HarnessPlatformInitOptions
): Promise<HarnessPlatformRunner> => {
  assertAppleDevicePhysical(config.device);
  const permissionsEnabled = harnessConfig.permissions ?? false;

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

  const isAvailable = await devicectl.isAppInstalled(deviceId, config.bundleId);

  if (!isAvailable) {
    throw new AppNotInstalledError(
      config.bundleId,
      getDeviceName(config.device)
    );
  }

  const xctestAgent =
    permissionsEnabled && config.device.codeSign
      ? createXCTestAgentController({
          appBundleId: config.bundleId,
          target: {
            kind: 'device',
            id: device.hardwareProperties.udid,
            codeSign: config.device.codeSign,
          },
          capabilities: [createPermissionPromptAutoAcceptCapability()],
        })
      : null;

  if (xctestAgent) {
    let agentStarted = false;
    try {
      await xctestAgent.ensureStarted();
      agentStarted = true;
    } finally {
      if (!agentStarted) {
        await xctestAgent.dispose();
      }
    }
  } else if (permissionsEnabled) {
    iosInstanceLogger.info(
      'Skipping XCTest agent for physical device (no codeSign config provided)'
    );
  }

  return {
    createAppSession: async (options) => {
      await devicectl.stopApp(deviceId, config.bundleId);
      const launchOptions =
        (options as typeof config.appLaunchOptions | undefined) ??
        config.appLaunchOptions;
      const appInfo = await devicectl.getAppInfo(deviceId, config.bundleId);
      const processNames = getIosProcessNames(appInfo?.name, config.bundleId);
      const crashReporter = createIosCrashReporter({
        targetId: deviceId,
        targetType: 'device',
        bundleId: config.bundleId,
        processNames,
        minOccurredAt: Date.now(),
        crashArtifactWriter: init?.crashArtifactWriter,
      });

      return await createIosAppSession({
        launch: () =>
          devicectl.launchAppProcess(deviceId, config.bundleId, launchOptions),
        stopApp: () => devicectl.stopApp(deviceId, config.bundleId),
        isAppRunning: () => devicectl.isAppRunning(deviceId, config.bundleId),
        crashReporter,
      });
    },
    dispose: async () => {
      await xctestAgent?.dispose();
      await devicectl.stopApp(deviceId, config.bundleId);
    },
  };
};
