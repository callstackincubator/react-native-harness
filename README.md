![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

### Jest-style tool for testing native behavior directly on devices

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Bridge the testing gap: Jest-style tests in real native environments. Get the convenience of describe/it with full access to native modules.

## Features

- **Jest-Style Syntax, Native Power**: Write familiar describe/it tests that run in real iOS and Android environments with full native module access.
- **Best of Both Worlds**: Unlike Jest (Node.js only) or Maestro (UI-based), get convenient test syntax AND native environment execution.
- **Real Device & Simulator Testing**: Execute tests directly on iOS simulators and Android emulators — catch platform-specific issues Jest can't see.
- **Native Module Testing**: Test native modules, platform APIs, and device-specific functionality that's impossible with JavaScript-only runners.
- **Familiar Test Structure**: Use beforeEach, afterEach, describe, it, expect — all the testing patterns you know and love from Jest.
- **Zero Configuration Setup**: Drop-in replacement for your existing test workflow with TypeScript support and seamless CI/CD integration.

## Quick Configuration Example

```javascript
// rn-harness.config.mjs
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

const config = {
  entryPoint: './src/main.tsx',
  appRegistryComponentName: 'MyApp',

  runners: [
    androidPlatform({
      name: 'android',
      device: androidEmulator('Pixel_8_API_35'),
      bundleId: 'com.myapp',
    }),
    applePlatform({
      name: 'ios',
      device: appleSimulator('iPhone 16 Pro Max', '18.0'),
      bundleId: 'com.myapp',
    }),
  ],
  defaultRunner: 'android',
};

export default config;
```

## Documentation

The documentation is available at [react-native-harness.dev](https://react-native-harness.dev). You can also use the following links to jump to specific topics:

- [Quick Start](https://react-native-harness.dev/docs/getting-started/quick-start)
- [Problem Statement](https://react-native-harness.dev/docs/getting-started/problem-statement)
- [Feature Comparison](https://react-native-harness.dev/docs/feature-comparison)
- [API Reference](https://react-native-harness.dev/docs/api/defining-tests)

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
