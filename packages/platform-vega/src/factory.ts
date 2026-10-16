import { HarnessPlatform } from '@react-native-harness/platforms';
import type { VegaDeviceInput, VegaPlatformConfigInput } from './config.js';

export const DEFAULT_VEGA_VIRTUAL_DEVICE_ID = 'VirtualDevice';

/**
 * Targets the Vega Virtual Device. Harness starts it when it is not running.
 */
export const vegaVirtualDevice = (
  deviceId: string = DEFAULT_VEGA_VIRTUAL_DEVICE_ID
): VegaDeviceInput => ({
  type: 'emulator',
  deviceId,
});

/** @deprecated Use `vegaVirtualDevice`. */
export const vegaEmulator = vegaVirtualDevice;

/**
 * Targets a Fire TV device in developer mode. `serial` is the device serial
 * number printed by `vega device list`.
 */
export const vegaPhysicalDevice = (serial: string): VegaDeviceInput => ({
  type: 'physical',
  serial,
});

const getLockKey = (device: VegaDeviceInput): string =>
  device.type === 'physical'
    ? `vega:physical:${device.serial}`
    : `vega:virtual:${device.deviceId ?? DEFAULT_VEGA_VIRTUAL_DEVICE_ID}`;

export const vegaPlatform = (
  config: VegaPlatformConfigInput
): HarnessPlatform<VegaPlatformConfigInput> => ({
  name: config.name,
  config,
  runner: import.meta.resolve('./runner.js'),
  metroConfigEnhancer: import.meta.resolve('./metro-config-enhancer.js'),
  platformId: 'vega',
  // React Native for Vega requests "kepler" bundles from Metro.
  bundlePlatform: 'kepler',
  getResourceLockKey: () => getLockKey(config.device),
});
