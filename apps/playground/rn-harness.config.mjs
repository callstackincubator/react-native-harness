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

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'HarnessPlayground',

  runners: [
    androidPlatform({
      name: 'pixel_8_api_33',
      device: androidEmulator('Pixel_8_API_33'),
      bundleId: 'com.example',
    }),
    applePlatform({
      name: 'iphone-16-pro-max',
      device: appleSimulator('iPhone 16 Pro Max', '26.0'),
      bundleId: 'com.example',
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
  defaultRunner: 'pixel_8_api_33',
};
