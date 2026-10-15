import {
  DeviceNotFoundError,
  type HarnessPlatformRunnerFactory,
} from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import {
  instrumented,
  isInteractive,
  logger,
  noopDiagnostics,
} from '@react-native-harness/tools';
import {
  getVegaComponentId,
  VegaPlatformConfigSchema,
  type VegaPlatformConfigInput,
} from './config.js';
import * as vegaModule from './vega.js';
import { getOptionalHarnessAppPath } from './app-path.js';
import { VegaAppPathError } from './errors.js';
import { configureVegaMetroAccess } from './port-forwarding.js';
import { createVegaAppSession } from './app-session.js';

const log = logger.child('platform-vega');

const getVegaRunner: HarnessPlatformRunnerFactory<
  VegaPlatformConfigInput,
  HarnessConfig
> = async (config, harnessConfig, init) => {
  const parsedConfig = VegaPlatformConfigSchema.parse(config);
  const vega = instrumented(
    vegaModule,
    'platform.vega.cli',
    init.diagnostics ?? noopDiagnostics
  );
  const { bundleId } = parsedConfig;
  const componentId = getVegaComponentId(parsedConfig);

  await vega.ensureVegaCliAvailable();

  let deviceId: string;
  let startedByHarness = false;

  const stopVirtualDeviceIfStarted = async () => {
    if (startedByHarness) {
      logger.info('Shutting down Vega virtual device...');
      await vega.stopVirtualDevice();
    }
  };

  // Nothing owns the device until the runner is returned, so a failure after
  // starting the virtual device must shut it down again.
  const cleanUpOnFailure = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      await stopVirtualDeviceIfStarted();
      throw error;
    }
  };

  const isVirtual = parsedConfig.device.type === 'emulator';

  if (parsedConfig.device.type === 'emulator') {
    const preferredId = parsedConfig.device.deviceId;
    let resolvedId = await vega.findConnectedVirtualDevice(preferredId);

    if (!resolvedId) {
      logger.info('Starting Vega virtual device...');
      await vega.startVirtualDevice({
        signal: init.signal,
        gui: isInteractive(),
      });
      startedByHarness = true;
      resolvedId = await cleanUpOnFailure(() =>
        vega.waitForVirtualDevice(preferredId, init.signal)
      );
    }

    deviceId = resolvedId;
  } else {
    deviceId = parsedConfig.device.serial;

    if (!(await vega.isDeviceConnected(deviceId))) {
      log.error(
        'Fire TV %s is not connected. Enable developer mode on the device ("vega devmode login", then "vega devmode enable-device --code <code>") and check "vega device list".',
        deviceId
      );
      throw new DeviceNotFoundError(deviceId);
    }
  }

  log.debug('using Vega device %s', deviceId);

  const prepareApp = async () => {
    const appPath = getOptionalHarnessAppPath();

    if (appPath) {
      logger.info('Installing %s on %s...', bundleId, deviceId);
      await vega.installApp(deviceId, appPath, {
        signal: init.signal,
        buildType: parsedConfig.buildType,
      });
    } else if (!(await vega.isAppInstalled(deviceId, componentId))) {
      throw new VegaAppPathError('missing');
    }

    return await configureVegaMetroAccess(
      vega,
      { deviceId, isVirtual },
      harnessConfig.metroPort
    );
  };

  const metroAccess = await cleanUpOnFailure(prepareApp);

  return {
    createAppSession: async () => {
      await vega.terminateApp(deviceId, componentId);

      return await createVegaAppSession({
        launchApp: () => vega.launchApp(deviceId, componentId),
        terminateApp: () => vega.terminateApp(deviceId, componentId),
        getAppRunState: () => vega.getAppRunState(deviceId, componentId),
        startLogStream: () => vega.startLogStream(deviceId),
        stopLogStream: () => vega.stopLogStream(deviceId),
      });
    },
    dispose: async () => {
      await vega.terminateApp(deviceId, componentId);
      await metroAccess.dispose();
      await stopVirtualDeviceIfStarted();
    },
  };
};

export default getVegaRunner;
