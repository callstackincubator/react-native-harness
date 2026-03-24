![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

### GitHub Action for React Native Harness

[![mit licence][license-badge]][license]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

GitHub Action that simplifies running React Native Harness tests in CI/CD environments. It lives at the repository root and handles the setup of emulators, simulators, browsers, and test execution automatically based on the selected Harness runner.

## Action

Use:

```yaml
- uses: callstackincubator/react-native-harness@main
```

The action reads your `rn-harness.config.mjs` file, resolves the `runner` you pass in, and uses that runner's `platformId` to decide which platform-specific setup to execute.

## Inputs

- `runner` (required): The runner name from your Harness configuration
- `app` (optional): Path to your built app. Required for native runs (`.apk` for Android, `.app` for iOS), not needed for web
- `projectRoot` (optional): The project root directory (defaults to repository root)
- `uploadVisualTestArtifacts` (optional): Whether to upload visual test diff and actual images as artifacts
- `harnessArgs` (optional): Additional arguments to pass to the Harness CLI
- `packageManager` (optional): Override package manager auto-detection. Supported values: `npm`, `yarn`, `pnpm`, `bun`, `deno`
- `cacheAvd` (optional, Android only): Whether to cache the Android Virtual Device snapshot. Defaults to `true`
- `preRunHook` (optional): Inline shell script run in `bash` immediately before Harness starts
- `afterRunHook` (optional): Inline shell script run in `bash` immediately after Harness finishes and before artifact upload
- Crash artifacts persisted to `.harness/crash-reports/` are uploaded automatically when present
- Metro cache persisted to `.harness/metro-cache/` is restored and saved automatically when present

## Behavior

Depending on the selected runner, the action:

- For Android runners, loads and validates your Harness configuration, restores Metro cache, sets up the Android emulator with architecture detection, optionally caches AVD snapshots, installs your app on the emulator, runs the hooks inside the emulator session, and runs the Harness tests
- For iOS runners, loads and validates your Harness configuration, restores Metro cache, sets up the iOS simulator, installs your app on the simulator, runs the hooks around the Harness invocation, and runs the Harness tests
- For web runners, loads and validates your Harness configuration, restores Metro cache, installs Playwright Chromium, runs the hooks around the Harness invocation, and runs the Harness tests

Hook behavior:

- Hooks are optional; empty inputs disable them.
- Hook inputs are treated as inline shell scripts, not file paths.
- Hooks run in `bash` with `HARNESS_PROJECT_ROOT` and `HARNESS_RUNNER` exported.
- `afterRunHook` also receives `HARNESS_EXIT_CODE`.
- A non-zero exit from either hook fails the action.
- `afterRunHook` runs only after the Harness command is invoked.
- On Android, both hooks run inside the emulator-runner session so they can access `adb` and the booted emulator.

Runner configuration requirements:

- Android runners must include an `avd` property with `apiLevel`, `profile`, `diskSize`, and `heapSize`
- iOS runners must include a `device` property with `name` and `systemVersion`

## Examples

### Android runner

```yaml
- uses: callstackincubator/react-native-harness@main
  with:
    app: './android/app/build/outputs/apk/debug/app-debug.apk'
    runner: 'android'
    projectRoot: './apps/my-app'
    packageManager: 'pnpm'
    cacheAvd: false
    preRunHook: |
      adb shell settings put global window_animation_scale 0
      adb shell settings put global transition_animation_scale 0
    afterRunHook: |
      echo "Harness finished with exit code: $HARNESS_EXIT_CODE"
```

### iOS runner

```yaml
- uses: callstackincubator/react-native-harness@main
  with:
    app: './ios/build/Build/Products/Debug-iphonesimulator/MyApp.app'
    runner: 'ios'
    projectRoot: './apps/my-app'
    preRunHook: |
      xcrun simctl privacy booted grant photos com.example.myapp
    afterRunHook: |
      echo "Harness finished with exit code: $HARNESS_EXIT_CODE"
```

### Web runner

```yaml
- uses: callstackincubator/react-native-harness@main
  with:
    runner: 'chromium'
    projectRoot: './apps/my-app'
    preRunHook: |
      echo "About to run Harness in $HARNESS_PROJECT_ROOT"
    afterRunHook: |
      echo "Harness finished with exit code: $HARNESS_EXIT_CODE"
```

## Usage

The action is designed to work with your existing React Native Harness configuration. It automatically reads `rn-harness.config.mjs` to determine device and platform settings, so you don't need to hardcode emulator or simulator configuration in workflow files.

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
