import { type HarnessPlatformRunnerFactory } from '@react-native-harness/platforms';
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

const getAppleRunner: HarnessPlatformRunnerFactory<
  ApplePlatformConfig,
  HarnessConfig
> = async (config, harnessConfig, init) => {
  const parsedConfig = ApplePlatformConfigSchema.parse(config);

  if (isAppleDeviceSimulator(parsedConfig.device)) {
    return getAppleSimulatorPlatformInstance(parsedConfig, harnessConfig, init);
  }

  return getApplePhysicalDevicePlatformInstance(
    parsedConfig,
    harnessConfig,
    init
  );
};

export default getAppleRunner;
