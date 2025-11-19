# Running in CI/CD

React Native Harness can be launched in CI environments like GitHub Actions, making it an excellent choice for automated testing of native functionality. In fact, React Native Harness's internal test suite runs using Harness itself in CI, proving its reliability and effectiveness in cloud environments.

## Performance Overview

The amount of time needed to run Harness tests is typically around **5 minutes** for test execution. However, depending on how your app is built and the complexity of your native modules, the total CI time can be as high as **20 minutes** when including build times.

:::tip
React Native Harness doesn't require you to constantly rebuild the app from scratch. You can reuse the same debug build as long as your native modules stay the same, significantly reducing CI execution time through intelligent caching.
:::

## Official GitHub Actions

React Native Harness provides official GitHub Actions that simplify running tests in CI/CD environments. These actions handle the complex setup of emulators, simulators, and test execution automatically.

### Available Actions

- **Android Action**: `callstackincubator/react-native-harness/actions/android`
- **iOS Action**: `callstackincubator/react-native-harness/actions/ios`

:::tip Versioning
You can pin to a specific version by appending `@<version>` to the action path (e.g., `@main`, `@v1.0.0`). For production use, we recommend pinning to a specific release tag once available.
:::

Both actions automatically:

- Load your React Native Harness configuration
- Set up and configure the emulator/simulator based on your config
- Install your app
- Run the tests

The actions read your `rn-harness.config.mjs` file to determine the device configuration, so you don't need to hardcode emulator settings in your workflow.

### Action Inputs

Both actions accept the following inputs:

- `app` (required): Path to your built app (`.apk` for Android, `.app` for iOS)
- `runner` (required): The runner name (e.g., `"android"` or `"ios"`)
- `projectRoot` (optional): The project root directory (defaults to the repository root)

## GitHub Actions Example

The example workflow shared below is designed for **React Native Community CLI** setups. If you're using **Expo** or **Rock**, the workflow will be simpler as these frameworks provide their own build and deployment mechanisms that integrate seamlessly with CI/CD environments.

Here's a complete GitHub Actions workflow that demonstrates how to run React Native Harness tests on both Android and iOS platforms using the official actions:

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
      # Step 1: Setup the environment
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

      # Step 2: Build optimization with caching
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

      # Step 3: Run Harness tests
      - name: Run React Native Harness
        uses: callstackincubator/react-native-harness/actions/android@main
        with:
          app: android/app/build/outputs/apk/debug/app-debug.apk
          runner: android

  test-ios:
    name: Test iOS
    runs-on: macos-latest
    if: ${{ github.event.inputs.platform == 'all' || github.event.inputs.platform == 'ios' || github.event.inputs.platform == null }}
    env:
      DEVELOPER_DIR: /Applications/Xcode_16.4.0.app/Contents/Developer

    steps:
      # Step 1: Setup the environment
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

      # Watchman dramatically speeds up file crawling for large projects
      - name: Install Watchman
        run: brew install watchman

      - name: Install dependencies
        run: pnpm install

      # Step 2: iOS build optimization with caching
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

      # Step 3: Run Harness tests
      - name: Run React Native Harness
        uses: callstackincubator/react-native-harness/actions/ios@main
        with:
          app: ios/build/Build/Products/Debug-iphonesimulator/YourApp.app
          runner: ios
```

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

If you're using frameworks like **Expo** or **Rock**, you'll benefit from sophisticated fingerprinting solutions that are guaranteed to correctly detect changes and rebuild when necessary. These frameworks include:

- **Intelligent dependency tracking** that monitors all relevant files
- **Granular cache invalidation** based on comprehensive file fingerprints
- **Automated rebuild triggers** when native modules or configurations change

This makes caching much more reliable and reduces the need for manual cache management.

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
