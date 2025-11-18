import { HarnessPlatformRunner } from '@react-native-harness/platforms';
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
  config: ApplePlatformConfig
): Promise<HarnessPlatformRunner> => {
  const parsedConfig = ApplePlatformConfigSchema.parse(config);

  if (isAppleDeviceSimulator(parsedConfig.device)) {
    return getAppleSimulatorPlatformInstance(parsedConfig);
  }

  return getApplePhysicalDevicePlatformInstance(parsedConfig);
};

export default getAppleRunner;
