# Running in CI/CD

React Native Harness can be launched in CI environments like GitHub Actions, making it an excellent choice for automated testing of native functionality. In fact, React Native Harness's internal test suite runs using Harness itself in CI, proving its reliability and effectiveness in cloud environments.

## Performance Overview

The amount of time needed to run Harness tests is typically around **5 minutes** for test execution. However, depending on how your app is built and the complexity of your native modules, the total CI time can be as high as **20 minutes** when including build times.

:::tip
React Native Harness doesn't require you to constantly rebuild the app from scratch. You can reuse the same debug build as long as your native modules stay the same, significantly reducing CI execution time through intelligent caching.
:::

## Official GitHub Action

React Native Harness provides an official GitHub Action that simplifies running tests in CI/CD environments. It handles the setup of emulators, simulators, browsers, and test execution automatically.

### Action

- `callstackincubator/react-native-harness`

:::tip Versioning
You can pin to a specific version by appending `@<version>` to the action path (e.g., `@main`, `@v1.0.0`). For production use, we recommend pinning to a specific release tag once available.
:::

The action automatically:

- Loads your React Native Harness configuration
- Sets up and configures the emulator, simulator, or browser based on your config
- Installs your app for native runners
- Runs the tests
- Uploads crash reports from `.harness/crash-reports/` as workflow artifacts whenever a run produces them

The action reads your `rn-harness.config.mjs` file to determine the selected runner's platform and device configuration, so you don't need to hardcode emulator or simulator settings in your workflow.

### Action Inputs

The action accepts the following inputs:

- `app` (optional): Path to your built app (`.apk` for Android, `.app` for iOS). Not needed for web runners
- `runner` (required): The runner name from your Harness config (for example `"android"`, `"ios"`, or `"chromium"`)
- `projectRoot` (optional): The project root directory (defaults to the repository root)
- `uploadVisualTestArtifacts` (optional): Whether to upload visual test diff and actual images as artifacts
- `harnessArgs` (optional): Additional arguments to pass to the Harness CLI
- `packageManager` (optional): Override package manager auto-detection. Supported values: `npm`, `yarn`, `pnpm`, `bun`, `deno`
- `cacheAvd` (optional, Android only): Whether to cache the Android Virtual Device snapshot. Defaults to `true`
- `preRunHook` (optional): Inline shell script run in `bash` immediately before Harness starts
- `afterRunHook` (optional): Inline shell script run in `bash` immediately after Harness finishes and before artifacts are uploaded

## Crash Artifacts

Harness monitors native crashes throughout the entire test lifecycle — including during **app startup**, before any test code runs. When the app crashes on launch (or at any point during the run), Harness captures the crash report and attaches a parsed stack trace to the failing test or startup error output.

Crash reports are persisted under `.harness/crash-reports/` in the current working directory. Filenames include the Harness run timestamp and selected runner name so CI downloads are easy to correlate with a specific workflow run.

The official GitHub Action uploads `.harness/crash-reports/**/*` automatically (with `if-no-files-found: ignore`), so crash reports appear as downloadable workflow artifacts whenever a run produces them — no extra configuration needed.

:::tip
Startup crashes are treated as a first-class failure. If your app crashes before the bridge connects, Harness immediately reports it with the native crash details rather than timing out.
:::

## GitHub Actions Example

The example workflow shared below is designed for **React Native Community CLI** setups. If you're using **Expo** or **Rock**, the workflow will be simpler as these frameworks provide their own build and deployment mechanisms that integrate seamlessly with CI/CD environments.

Here's a complete GitHub Actions workflow that demonstrates how to run React Native Harness tests on both Android and iOS platforms using the official action:

### Complete Workflow Configuration

```yaml
name: Run React Native Harness

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      platform:
        description: 'Platform to test'
        required: false
        default: 'all'
        type: choice
        options:
          - all
          - android
          - ios

jobs:
  test-android:
    name: Test Android
    runs-on: ubuntu-latest
    if: ${{ github.event.inputs.platform == 'all' || github.event.inputs.platform == 'android' || github.event.inputs.platform == null }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: latest

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '23'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Set up JDK 17
        uses: actions/setup-java@v3
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Restore APK from cache
        id: cache-apk-restore
        uses: actions/cache/restore@v4
        with:
          path: android/app/build/outputs/apk/debug/app-debug.apk
          key: android-app-${{ hashFiles('android/**/*.gradle*', 'android/**/gradle-wrapper.properties') }}

      - name: Build Android app
        if: steps.cache-apk-restore.outputs.cache-hit != 'true'
        run: |
          cd android && ./gradlew assembleDebug

      - name: Save APK to cache
        if: steps.cache-apk-restore.outputs.cache-hit != 'true' && success()
        uses: actions/cache/save@v4
        with:
          path: android/app/build/outputs/apk/debug/app-debug.apk
          key: android-app-${{ hashFiles('android/**/*.gradle*', 'android/**/gradle-wrapper.properties') }}

      - name: Run React Native Harness
        uses: callstackincubator/react-native-harness@main
        with:
          app: android/app/build/outputs/apk/debug/app-debug.apk
          runner: android
          packageManager: pnpm
          cacheAvd: false
          preRunHook: |
            adb shell settings put global window_animation_scale 0
            adb shell settings put global transition_animation_scale 0
          afterRunHook: |
            echo "Harness finished with exit code: $HARNESS_EXIT_CODE"

  test-ios:
    name: Test iOS
    runs-on: macos-latest
    if: ${{ github.event.inputs.platform == 'all' || github.event.inputs.platform == 'ios' || github.event.inputs.platform == null }}
    env:
      DEVELOPER_DIR: /Applications/Xcode_16.4.0.app/Contents/Developer

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: latest

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install Watchman
        run: brew install watchman

      - name: Install dependencies
        run: pnpm install

      - name: Restore app from cache
        id: cache-app-restore
        uses: actions/cache/restore@v4
        with:
          path: ios/build/Build/Products/Debug-iphonesimulator/YourApp.app
          key: ios-app-${{ hashFiles('ios/Podfile.lock', 'ios/**/*.pbxproj') }}

      - name: CocoaPods cache
        if: steps.cache-app-restore.outputs.cache-hit != 'true'
        uses: actions/cache@v4
        with:
          path: |
            ./ios/Pods
            ~/Library/Caches/CocoaPods
            ~/.cocoapods
          key: pods-${{ runner.os }}-${{ hashFiles('./ios/Podfile.lock') }}

      - name: Install CocoaPods
        if: steps.cache-app-restore.outputs.cache-hit != 'true'
        working-directory: ios
        run: pod install

      - name: Build iOS app
        if: steps.cache-app-restore.outputs.cache-hit != 'true'
        run: npx react-native build-ios --verbose

      - name: Save app to cache
        if: steps.cache-app-restore.outputs.cache-hit != 'true' && success()
        uses: actions/cache/save@v4
        with:
          path: ios/build/Build/Products/Debug-iphonesimulator/YourApp.app
          key: ios-app-${{ hashFiles('ios/Podfile.lock', 'ios/**/*.pbxproj') }}

      - name: Run React Native Harness
        uses: callstackincubator/react-native-harness@main
        with:
          app: ios/build/Build/Products/Debug-iphonesimulator/YourApp.app
          runner: ios
          preRunHook: |
            xcrun simctl privacy booted grant photos com.example.myapp
          afterRunHook: |
            echo "Harness finished with exit code: $HARNESS_EXIT_CODE"
```

## Hook Scripts

The official action can run optional shell hooks around the Harness invocation:

- `preRunHook` runs in `bash` immediately before the Harness CLI command.
- `afterRunHook` runs in `bash` immediately after the Harness CLI command and before artifact upload, even if Harness fails.
- Both hooks receive `HARNESS_PROJECT_ROOT` and `HARNESS_RUNNER`.
- `afterRunHook` also receives `HARNESS_EXIT_CODE`.
- A non-zero exit from either hook fails the action.
- `afterRunHook` runs only when execution reached the Harness command.

On Android, both hooks execute inside the `android-emulator-runner` session, so they can safely use `adb` against the active emulator. On iOS, the hooks run after the simulator is booted and the app is installed. On web, the same inputs are available for consistency and run immediately before and after the Harness command.

## Metro cache

React Native Harness can persist Metro's transformation cache under `.harness/metro-cache` in your project root. Enabling it in config (`unstable__enableMetroCache: true`) speeds up repeated Metro runs.

When you use the `callstackincubator/react-native-harness` GitHub Action, Metro cache restoration and saving is handled automatically for the resolved `projectRoot`. You do not need to add a separate `actions/cache` step for `.harness/metro-cache`.

## Build Artifact Caching

The workflow includes build artifact caching to significantly reduce CI execution times. When native modules haven't changed, you can reuse the same debug builds instead of rebuilding from scratch.

### How Caching Works

- **Android**: Caches the built APK file using `android-app-*` keys based on Gradle configuration file hashes
- **iOS**: Caches the built app bundle using `ios-app-*` keys based on Podfile.lock and project file hashes

### Cache Limitations

While caching is enabled in the workflow, **it may not always be correctly purged when needed**. GitHub Actions cache invalidation can sometimes miss subtle changes that should trigger a rebuild. If you encounter issues with stale builds or unexpected test failures, you may need to **manually purge the cache through the GitHub UI**:

1. Go to your repository's **Actions** tab
2. Click on **Caches** in the left sidebar
3. Find and delete the relevant cache entries (`android-app-*` or `ios-app-*`)

### Advanced Frameworks

If you're using frameworks like **Expo** or **Rock**, you'll benefit from sophisticated fingerprinting solutions that are guaranteed to correctly detect changes and rebuild when necessary.

## Adapting for Your Project

### React Native Community CLI Projects

For standard React Native Community CLI projects, adapt the workflow by:

1. **Update App Names**: Replace `YourApp` with your actual app name in the iOS configuration
2. **Verify Paths**: Ensure build output paths match your project structure
3. **Test Command**: Use `npx react-native-harness --harnessRunner [platform]` to run tests on the specified platform

### Expo Projects

For Expo projects, the workflow will be simpler using **Expo Application Services (EAS)**:

- Use **EAS Build** (remote or local) instead of native build steps
- Leverage EAS's built-in caching and fingerprinting
- Install the app using EAS CLI tools

### Rock Projects

For Rock projects:

- Use Rock's integrated build commands
- Benefit from Rock's advanced caching mechanisms
- Follow Rock's CI/CD best practices for optimal performance
