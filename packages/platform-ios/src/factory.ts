import { HarnessPlatform } from '@react-native-harness/platforms';
import type {
  AppleSimulator,
  ApplePhysicalDevice,
  ApplePhysicalDeviceCodeSign,
  ApplePlatformConfig,
} from './config.js';
import { shouldDeferMetroPrewarmUntilBooted } from './startup-strategy.js';

export const appleSimulator = (
  name: string,
  systemVersion: string,
  options?: { slimOnCI?: boolean }
): AppleSimulator => ({
  type: 'simulator',
  name,
  systemVersion,
  ...(options?.slimOnCI === undefined ? {} : { slimOnCI: options.slimOnCI }),
});

export const applePhysicalDevice = (
  name: string,
  options?: { codeSign?: ApplePhysicalDeviceCodeSign },
): ApplePhysicalDevice => ({
  type: 'physical',
  name,
  codeSign: options?.codeSign,
});

export const applePlatform = (
  config: ApplePlatformConfig
): HarnessPlatform<ApplePlatformConfig> => ({
  name: config.name,
  config,
  runner: import.meta.resolve('./runner.js'),
  cli: import.meta.resolve('./cli.js'),
  platformId: 'ios',
  getResourceLockKey: () =>
    config.device.type === 'simulator'
      ? `ios:simulator:${config.device.name}:${config.device.systemVersion}`
      : `ios:physical:${config.device.name}`,
  deferMetroPrewarm: () =>
    config.device.type === 'simulator' && shouldDeferMetroPrewarmUntilBooted(),
});
