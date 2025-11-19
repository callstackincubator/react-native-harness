![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

### GitHub Actions for React Native Harness

[![mit licence][license-badge]][license]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

GitHub Actions that simplify running React Native Harness tests in CI/CD environments. These actions handle the complex setup of emulators, simulators, and test execution automatically.

## Available Actions

This package provides two GitHub Actions:

### `android`

Runs React Native Harness tests on Android emulators. This action handles:

- Loading and validating your Harness configuration
- Setting up Android emulator with proper architecture detection
- Caching AVD snapshots for faster subsequent runs
- Installing your app on the emulator
- Running the Harness tests

**Inputs:**

- `app` (required): Path to your built Android app (`.apk` file)
- `runner` (required): The runner name from your configuration
- `projectRoot` (optional): The project root directory (defaults to repository root)

**Requirements:**

- Your runner configuration must include an `avd` property with:
  - `apiLevel`: Android API level
  - `profile`: AVD profile name
  - `diskSize`: Disk size for the AVD
  - `heapSize`: Heap size for the emulator

**Example:**

```yaml
- uses: callstackincubator/react-native-harness/actions/android@main
  with:
    app: './android/app/build/outputs/apk/debug/app-debug.apk'
    runner: 'android'
    projectRoot: './apps/my-app'
```

### `ios`

Runs React Native Harness tests on iOS simulators. This action handles:

- Loading and validating your Harness configuration
- Setting up iOS simulator with the specified device and OS version
- Installing your app on the simulator
- Running the Harness tests

**Inputs:**

- `app` (required): Path to your built iOS app (`.app` bundle)
- `runner` (required): The runner name from your configuration
- `projectRoot` (optional): The project root directory (defaults to repository root)

**Requirements:**

- Your runner configuration must include a `device` property with:
  - `name`: Simulator device name (e.g., "iPhone 15")
  - `systemVersion`: iOS version (e.g., "17.0")

**Example:**

```yaml
- uses: callstackincubator/react-native-harness/actions/ios@main
  with:
    app: './ios/build/Build/Products/Debug-iphonesimulator/MyApp.app'
    runner: 'ios'
    projectRoot: './apps/my-app'
```

## Usage

These actions are designed to work with your existing React Native Harness configuration. They automatically read your `rn-harness.config.mjs` file to determine device settings, so you don't need to hardcode emulator or simulator configurations in your workflow files.

For complete workflow examples, see the [CI/CD documentation](https://react-native-harness.dev/docs/guides/ci-cd).

## Made with ❤️ at Callstack

`@react-native-harness/github-action` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/@react-native-harness/github-action?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ../../CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
