import {
  androidPlatform,
  androidEmulator,
  physicalAndroidDevice,
} from '@react-native-harness/platform-android';
import {
  applePlatform,
  applePhysicalDevice,
  appleSimulator,
} from '@react-native-harness/platform-apple';
import {
  vegaPlatform,
  vegaEmulator,
} from '@react-native-harness/platform-vega';

const config = {
  entryPoint: './index.js',
  appRegistryComponentName: 'HarnessPlayground',

  runners: [
    androidPlatform({
      name: 'android',
      device: androidEmulator('Pixel_8_API_35'),
      bundleId: 'com.harnessplayground',
    }),
    androidPlatform({
      name: 'moto-g72',
      device: physicalAndroidDevice('Motorola', 'Moto G72'),
      bundleId: 'com.harnessplayground',
    }),
    applePlatform({
      name: 'iphone-16-pro',
      device: applePhysicalDevice('iPhone (Szymon) (2)'),
      bundleId: 'react-native-harness',
    }),
    applePlatform({
      name: 'ios',
      device: appleSimulator('iPhone 16 Pro', '18.6'),
      bundleId: 'com.harnessplayground',
    }),
    vegaPlatform({
      name: 'vega',
      device: vegaEmulator('VegaTV_1'),
      bundleId: 'com.playground',
    }),
  ],
  defaultRunner: 'android',
  bridgeTimeout: 120000,

  resetEnvironmentBetweenTestFiles: true,
  unstable__skipAlreadyIncludedModules: false,
};

export default config;
