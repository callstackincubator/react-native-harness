import { HarnessPlatform } from '@react-native-harness/platforms';
import type {
  AppleSimulator,
  ApplePhysicalDevice,
  ApplePlatformConfig,
} from './config.js';

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
): HarnessPlatform<ApplePlatformConfig> => ({
  name: config.name,
  config,
  runner: import.meta.resolve('./runner.js'),
});
