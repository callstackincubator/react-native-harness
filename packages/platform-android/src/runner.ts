import { HarnessPlatformRunner } from '@react-native-harness/platforms';
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

const getAndroidRunner = async (
  config: AndroidPlatformConfig,
  harnessConfig: HarnessConfig
): Promise<HarnessPlatformRunner> => {
  const parsedConfig = AndroidPlatformConfigSchema.parse(config);

  if (isAndroidDeviceEmulator(parsedConfig.device)) {
    return getAndroidEmulatorPlatformInstance(parsedConfig, harnessConfig);
  }

  return getAndroidPhysicalDevicePlatformInstance(parsedConfig, harnessConfig);
};

export default getAndroidRunner;
