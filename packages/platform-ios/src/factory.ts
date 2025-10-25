import { HarnessPlatform } from '@react-native-harness/platforms';
import type {
  AppleSimulator,
  ApplePhysicalDevice,
  ApplePlatformConfig,
} from './config.js';
import { ApplePlatformConfigSchema, isAppleDeviceSimulator } from './config.js';
import {
  getApplePhysicalDevicePlatformInstance,
  getAppleSimulatorPlatformInstance,
} from './instance.js';

export const appleSimulator = (
  name: string,
  systemVersion: string
): AppleSimulator => ({
  type: 'simulator',
  name,
  systemVersion,
});

export const applePhysicalDevice = (name: string): ApplePhysicalDevice => ({
  type: 'physical',
  name,
});

export const applePlatform = (
  config: ApplePlatformConfig
): HarnessPlatform => ({
  name: config.name,
  getInstance: async () => {
    const parsedConfig = ApplePlatformConfigSchema.parse(config);

    if (isAppleDeviceSimulator(parsedConfig.device)) {
      return getAppleSimulatorPlatformInstance(parsedConfig);
    }

    return getApplePhysicalDevicePlatformInstance(parsedConfig);
  },
});
