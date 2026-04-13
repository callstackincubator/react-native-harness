import {
  HarnessPlatformRunner,
  type HarnessPlatformInitOptions,
} from '@react-native-harness/platforms';
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

const getAndroidRunner = async (
  config: AndroidPlatformConfig,
  harnessConfig: HarnessConfig,
  init: HarnessPlatformInitOptions,
): Promise<HarnessPlatformRunner> => {
  const parsedConfig = AndroidPlatformConfigSchema.parse(config);

  initializeAndroidProcessEnv();

  await ensureAndroidAdbAvailable();

  if (isAndroidDeviceEmulator(parsedConfig.device)) {
    return getAndroidEmulatorPlatformInstance(
      parsedConfig,
      harnessConfig,
      init,
    );
  }

  return getAndroidPhysicalDevicePlatformInstance(parsedConfig, harnessConfig);
};

export default getAndroidRunner;
