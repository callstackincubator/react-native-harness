import { androidPlatform, androidEmulator } from "@react-native-harness/platform-android";
import { applePlatform, appleSimulator } from "@react-native-harness/platform-apple";

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
  ],
  defaultRunner: 'pixel_8_api_33',
};
