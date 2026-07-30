import { type HarnessPlatformRunnerFactory } from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import {
  AndroidPlatformConfigSchema,
  type AndroidPlatformConfig,
  isAndroidDeviceEmulator,
} from './config.js';
import {
  getAndroidEmulatorPlatformInstance,
  getAndroidPhysicalDevicePlatformInstance,
} from './instance.js';
import {
  ensureAndroidAdbAvailable,
  initializeAndroidProcessEnv,
} from './environment.js';

const getAndroidRunner: HarnessPlatformRunnerFactory<
  AndroidPlatformConfig,
  HarnessConfig
> = async (config, harnessConfig, init) => {
  const parsedConfig = AndroidPlatformConfigSchema.parse(config);

  initializeAndroidProcessEnv();

  await ensureAndroidAdbAvailable();

  if (isAndroidDeviceEmulator(parsedConfig.device)) {
    return getAndroidEmulatorPlatformInstance(
      parsedConfig,
      harnessConfig,
      init
    );
  }

  return getAndroidPhysicalDevicePlatformInstance(
    parsedConfig,
    harnessConfig,
    init
  );
};

export default getAndroidRunner;
