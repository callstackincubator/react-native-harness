![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Android platform for React Native Harness - enables testing on Android emulators and physical devices.

## Installation

```bash
npm install @react-native-harness/platform-android
# or
pnpm add @react-native-harness/platform-android
# or
yarn add @react-native-harness/platform-android
```

## Usage

Import the Android platform functions in your `rn-harness.config.mjs`:

```javascript
import {
  androidPlatform,
  androidEmulator,
  physicalAndroidDevice,
} from '@react-native-harness/platform-android';

const config = {
  runners: [
    androidPlatform({
      name: 'android',
      device: androidEmulator('Pixel_8_API_35'),
      bundleId: 'com.your.app',
    }),
    androidPlatform({
      name: 'physical-device',
      device: physicalAndroidDevice('Motorola', 'Moto G72'),
      bundleId: 'com.your.app',
    }),
  ],
  // ... other config
};

export default config;
```

## API

### `androidPlatform(config)`

Creates an Android platform runner configuration.

**Parameters:**

- `config.name` - Unique name for the runner
- `config.device` - Android device configuration (emulator or physical)
- `config.bundleId` - Android application bundle ID

### `androidEmulator(deviceName)`

Creates an Android emulator device configuration.

**Parameters:**

- `deviceName` - Name of the Android emulator (e.g., 'Pixel_8_API_35')

### `physicalAndroidDevice(manufacturer, model)`

Creates a physical Android device configuration.

**Parameters:**

- `manufacturer` - Device manufacturer (e.g., 'Motorola')
- `model` - Device model (e.g., 'Moto G72')

## Requirements

- Android SDK installed
- Android emulator or physical device connected
- React Native project configured for Android

## Made with ❤️ at Callstack

`react-native-harness` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/react-native-harness?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/react-native-harness?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/react-native-harness
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ./CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
