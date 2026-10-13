import {
  vegaPlatform,
  vegaVirtualDevice,
  vegaPhysicalDevice,
} from '@react-native-harness/platform-vega';

// The [package] id from manifest.toml.
const bundleId = 'com.harnessplayground.vega';

export default {
  entryPoint: './index.js',
  // The Vega runtime runs the component registered under the interactive
  // component id from manifest.toml.
  appRegistryComponentName: 'com.harnessplayground.vega.main',
  runners: [
    vegaPlatform({
      name: 'vega',
      device: vegaVirtualDevice(),
      bundleId,
    }),
    vegaPlatform({
      name: 'fire-tv',
      // Replace with the serial number printed by `vega device list`.
      device: vegaPhysicalDevice(process.env.VEGA_DEVICE_SERIAL ?? 'FIRE_TV_SERIAL'),
      bundleId,
    }),
  ],
  defaultRunner: 'vega',
  // The virtual device can take a few minutes to boot on first start.
  platformReadyTimeout: 600000,
  bridgeTimeout: 120000,
  testTimeout: 10000,
  resetEnvironmentBetweenTestFiles: 'runtime',
  forwardClientLogs: true,
};
