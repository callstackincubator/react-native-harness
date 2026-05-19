![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

### Experimental Android Native Coverage for React Native Harness

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

⚠️ **EXPERIMENTAL** ⚠️

`@react-native-harness/coverage-android` adds native Android code coverage collection for React Native Harness. It uses JaCoCo offline instrumentation to instrument selected Gradle modules, collects `.ec` execution data files from the app during test runs, and writes a `native-coverage.lcov` report after the run finishes.

Coverage collection is supported on **Android emulators and physical devices** (debug builds only).

## Installation

```bash
npm install --save-dev @react-native-harness/coverage-android
# or
pnpm add -D @react-native-harness/coverage-android
# or
yarn add -D @react-native-harness/coverage-android
```

After installation, rebuild the app with the coverage init script (see Usage).

## Usage

Build the app with JaCoCo offline instrumentation:

```bash
cd android
./gradlew assembleDebug \
  --init-script ../node_modules/@react-native-harness/coverage-android/scripts/harness-coverage-init.gradle \
  -PHarnessCoverageModules=:mylib
cd ..
```

Add the modules you want to instrument in `rn-harness.config.mjs`:

```javascript
import { androidPlatform, androidEmulator } from '@react-native-harness/platform-android';

export default {
  runners: [
    androidPlatform({
      name: 'android',
      device: androidEmulator('Pixel_8_API_35'),
      bundleId: 'com.example.app',
    }),
  ],
  coverage: {
    native: {
      android: {
        modules: [':mylib'],
      },
    },
  },
};
```

Run Harness with coverage enabled:

```bash
react-native-harness --coverage --harnessRunner android
```

When coverage is collected successfully, Harness writes `native-coverage.lcov` to the project root.

## How it works

- A Gradle init script applies JaCoCo offline instrumentation to compiled Kotlin/Java class files
- Injects a ContentProvider that bootstraps a coverage flush helper on app startup
- The helper writes JaCoCo execution data (`.ec` files) to app internal storage every second
- After tests, Harness pulls `.ec` files from the device, merges them, and generates LCOV

## Requirements

- Android SDK with emulator or physical device
- Java 11+ (for JaCoCo CLI)
- Android runner configured with `@react-native-harness/platform-android`
- Debug build of the app using the coverage init script
- `@react-native-harness/coverage-android` installed (provides the init script and runtime helpers)

## Limitations

- Experimental and subject to change
- Requires building with the Gradle init script (`--init-script`)
- Coverage collection writes reports to the project root
- Build and test environments must share access to the build output (original class files + `jacococli.jar`)

## Made with ❤️ at Callstack

`@react-native-harness/coverage-android` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/@react-native-harness/coverage-android?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/@react-native-harness/coverage-android?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/@react-native-harness/coverage-android
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ../../CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
