import { HarnessPlatform } from '@react-native-harness/platforms';
import { type VegaPlatformConfig, type VegaEmulator } from './config.js';

export const vegaEmulator = (deviceId: string): VegaEmulator => ({
  type: 'emulator',
  deviceId,
});

export const vegaPlatform = (
  config: VegaPlatformConfig
): HarnessPlatform<VegaPlatformConfig> => ({
  name: config.name,
  config,
  runner: import.meta.resolve('./runner.js'),
});
