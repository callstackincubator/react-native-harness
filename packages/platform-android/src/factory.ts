import { HarnessPlatform } from '@react-native-harness/platforms';
import {
  type AndroidEmulator,
  type AndroidPlatformConfig,
  type PhysicalAndroidDevice,
  type AndroidEmulatorAVDConfig,
} from './config.js';

export const androidEmulator = (
  name: string,
  avd?: AndroidEmulatorAVDConfig
): AndroidEmulator => ({
  type: 'emulator',
  name,
  avd,
});

export const physicalAndroidDevice = (
  manufacturer: string,
  model: string
): PhysicalAndroidDevice => ({
  type: 'physical',
  manufacturer: manufacturer.toLowerCase(),
  model: model.toLowerCase(),
});

export const androidPlatform = (
  config: AndroidPlatformConfig
): HarnessPlatform<AndroidPlatformConfig> => ({
  name: config.name,
  config,
  runner: import.meta.resolve('./runner.js'),
  platformId: 'android',
  getResourceLockKey: () =>
    config.device.type === 'emulator'
      ? `android:emulator:${config.device.name}`
      : `android:physical:${config.device.manufacturer}:${config.device.model}`,
});
