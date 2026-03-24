import { HarnessPlatformRunner } from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import {
  ApplePlatformConfigSchema,
  type ApplePlatformConfig,
  isAppleDeviceSimulator,
} from './config.js';
import {
  getApplePhysicalDevicePlatformInstance,
  getAppleSimulatorPlatformInstance,
} from './instance.js';

const getAppleRunner = async (
  config: ApplePlatformConfig,
  harnessConfig: HarnessConfig
): Promise<HarnessPlatformRunner> => {
  const parsedConfig = ApplePlatformConfigSchema.parse(config);

  if (isAppleDeviceSimulator(parsedConfig.device)) {
    return getAppleSimulatorPlatformInstance(parsedConfig, harnessConfig);
  }

  return getApplePhysicalDevicePlatformInstance(parsedConfig, harnessConfig);
};

export default getAppleRunner;
