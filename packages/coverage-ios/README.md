![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

### Experimental iOS Native Coverage for React Native Harness

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

⚠️ **EXPERIMENTAL** ⚠️

`@react-native-harness/coverage-ios` adds native iOS code coverage collection for React Native Harness. It instruments selected CocoaPods, collects LLVM `.profraw` files from the app during test runs, and writes a `native-coverage.lcov` report after the run finishes.

At the moment, coverage collection is supported on **iOS simulators only**.

## Installation

```bash
npm install --save-dev @react-native-harness/coverage-ios
# or
pnpm add -D @react-native-harness/coverage-ios
# or
yarn add -D @react-native-harness/coverage-ios
```

After installation, run your iOS pod install step and rebuild the app.

## Usage

Add the pods you want to instrument in `rn-harness.config.mjs`:

```javascript
import { applePlatform, appleSimulator } from '@react-native-harness/platform-apple';

export default {
  runners: [
    applePlatform({
      name: 'ios',
      device: appleSimulator('iPhone 16 Pro', '18.0'),
      bundleId: 'com.example.app',
    }),
  ],
  coverage: {
    native: {
      ios: {
        pods: ['MyLibrary'],
      },
    },
  },
};
```

Run Harness with coverage enabled:

```bash
react-native-harness --coverage --harnessRunner ios
```

When coverage is collected successfully, Harness writes:

- `native-coverage.profdata`
- `native-coverage.lcov`

to the project root.

## How it works

- Injects coverage compiler and linker flags into the selected CocoaPods during `pod install`
- Links a small helper pod that periodically flushes LLVM profile data from the running app
- Stops the app before disposal so the final profile data is written
- Merges `.profraw` files and exports them as LCOV

## Requirements

- macOS with Xcode installed
- iOS runner configured with `@react-native-harness/platform-apple`
- CocoaPods-based iOS project
- Debug build of the app
- `xcrun llvm-profdata` and `xcrun llvm-cov` available in Xcode toolchain

## Limitations

- iOS only
- iOS simulator only for now
- Experimental and subject to change
- Designed for pod-based native dependencies listed in `coverage.native.ios.pods`
- Coverage collection currently writes reports to the project root

## Made with ❤️ at Callstack

`@react-native-harness/coverage-ios` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/@react-native-harness/coverage-ios?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/@react-native-harness/coverage-ios?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/@react-native-harness/coverage-ios
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ../../CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
