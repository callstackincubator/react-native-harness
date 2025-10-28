![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Vega platform for React Native Harness - enables testing on Vega TV devices and emulators.

## Installation

```bash
npm install @react-native-harness/platform-vega
# or
pnpm add @react-native-harness/platform-vega
# or
yarn add @react-native-harness/platform-vega
```

## Usage

Import the Vega platform functions in your `rn-harness.config.mjs`:

```javascript
import {
  vegaPlatform,
  vegaEmulator,
} from '@react-native-harness/platform-vega';

const config = {
  runners: [
    vegaPlatform({
      name: 'vega',
      device: vegaEmulator('VegaTV_1'),
      bundleId: 'com.your.app',
    }),
  ],
  // ... other config
};

export default config;
```

## API

### `vegaPlatform(config)`

Creates a Vega platform runner configuration.

**Parameters:**

- `config.name` - Unique name for the runner
- `config.device` - Vega device configuration (emulator)
- `config.bundleId` - Vega application bundle ID

### `vegaEmulator(deviceName)`

Creates a Vega emulator device configuration.

**Parameters:**

- `deviceName` - Name of the Vega emulator (e.g., 'VegaTV_1')

## Requirements

- Vega SDK installed
- Vega emulator running
- React Native project configured for Vega platform

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
