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
import {
  webPlatform,
  chromium,
  chrome,
} from '@react-native-harness/platform-web';
import { harnessLoggingPlugin } from './harness-logging-plugin.mjs';

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'HarnessPlayground',
  plugins: [harnessLoggingPlugin()],

  runners: [
    androidPlatform({
      name: 'android',
      device: androidEmulator('Pixel_8_API_35', {
        apiLevel: 35,
        profile: 'pixel_6',
        diskSize: '1G',
        heapSize: '1G',
      }),
      bundleId: 'com.harnessplayground',
    }),
    androidPlatform({
      name: 'android-crash-pre-rn',
      device: androidEmulator('Pixel_8_API_35', {
        apiLevel: 35,
        profile: 'pixel_6',
        diskSize: '1G',
        heapSize: '1G',
      }),
      bundleId: 'com.harnessplayground',
      appLaunchOptions: {
        extras: {
          harness_crash_mode: 'pre_rn',
        },
      },
    }),
    androidPlatform({
      name: 'android-crash-delayed',
      device: androidEmulator('Pixel_8_API_35', {
        apiLevel: 35,
        profile: 'pixel_6',
        diskSize: '1G',
        heapSize: '1G',
      }),
      bundleId: 'com.harnessplayground',
      appLaunchOptions: {
        extras: {
          harness_crash_mode: 'delayed_pre_ready',
        },
      },
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
      device: appleSimulator('iPhone 17 Pro', '26.2'),
      bundleId: 'com.harnessplayground',
    }),
    applePlatform({
      name: 'ios-crash-pre-rn',
      device: appleSimulator('iPhone 16 Pro', '18.6'),
      bundleId: 'com.harnessplayground',
      appLaunchOptions: {
        environment: {
          HARNESS_CRASH_MODE: 'pre_rn',
        },
      },
    }),
    applePlatform({
      name: 'ios-crash-delayed',
      device: appleSimulator('iPhone 16 Pro', '18.6'),
      bundleId: 'com.harnessplayground',
      appLaunchOptions: {
        environment: {
          HARNESS_CRASH_MODE: 'delayed_pre_ready',
        },
      },
    }),
    vegaPlatform({
      name: 'vega',
      device: vegaEmulator('VegaTV_1'),
      bundleId: 'com.playground',
    }),
    webPlatform({
      name: 'web',
      browser: chrome('http://localhost:8081/index.html', { headless: false }),
    }),
    webPlatform({
      name: 'chromium',
      browser: chromium('http://localhost:8081/index.html', { headless: true }),
    }),
  ],
  defaultRunner: 'android',
  platformReadyTimeout: 300000,
  bridgeTimeout: 120000,

  resetEnvironmentBetweenTestFiles: true,
  unstable__enableMetroCache: true,
  unstable__skipAlreadyIncludedModules: false,
  forwardClientLogs: true,
  disableViewFlattening: true,
};
