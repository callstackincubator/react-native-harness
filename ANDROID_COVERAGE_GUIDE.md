# Android Native Coverage — Local Testing Guide

How to test Android native (Kotlin/Java) code coverage collection with a local React Native library module.

## Prerequisites

- Android SDK with an emulator image
- Java 11+ (for JaCoCo CLI)
- A React Native library with an `android/` module and an example/playground app

## 1. Install the coverage package

From your library's example/playground app directory:

```bash
# If using the harness monorepo locally (linked):
pnpm add @react-native-harness/coverage-android --workspace

# Or from npm (once published):
npm install --save-dev @react-native-harness/coverage-android
```

## 2. Build the app with coverage instrumentation

The init script handles everything — no changes to your `build.gradle` needed.

```bash
cd android

./gradlew assembleDebug \
  --init-script ../node_modules/@react-native-harness/coverage-android/scripts/harness-coverage-init.gradle \
  -PHarnessCoverageModules=:mylib

cd ..
```

Replace `:mylib` with your library's Gradle module path (e.g. `:react-native-my-lib`, `:android`). You can instrument multiple modules: `-PHarnessCoverageModules=:moduleA,:moduleB`.

### What the init script does

- Adds JaCoCo offline instrumentation to the specified modules' compiled classes
- Injects `CoverageHelper` + `CoverageInitProvider` into the debug build
- Saves original (uninstrumented) class files + `jacococli.jar` to `<module>/build/harness-coverage/`
- Adds `BuildConfig.COVERAGE_ENABLED = true`

### Verify instrumentation worked

```bash
javap -p android/<module>/build/tmp/kotlin-classes/debug/com/example/MyClass.class | grep jacoco
```

You should see `$jacocoInit` — that means JaCoCo probes are present.

## 3. Configure harness

In your `rn-harness.config.mjs`:

```javascript
import { androidPlatform, androidEmulator } from '@react-native-harness/platform-android';

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'MyApp',
  runners: [
    androidPlatform({
      name: 'android',
      device: androidEmulator('Pixel_8_API_35'),
      bundleId: 'com.example.myapp',
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

The `modules` array must match the module paths you passed to the init script.

## 4. Run tests with coverage

```bash
npx react-native-harness --coverage --harnessRunner android
```

After tests complete, the harness will:

1. Stop the app (triggers `am force-stop`)
2. Wait 2 seconds for the JaCoCo flush timer to write final data
3. Pull `.ec` files from the app's internal storage via `adb`
4. Merge them using `jacococli.jar` (from the build output)
5. Generate an XML report using the original (uninstrumented) class files
6. Convert to lcov format

Output: `native-coverage.lcov` in the project root.

## 5. View the report

```bash
# Quick summary
grep -c "^DA:" native-coverage.lcov
# -> number of instrumented lines

# Generate HTML (requires lcov tools)
genhtml native-coverage.lcov -o coverage-html
open coverage-html/index.html
```

## How it works

### Build time

The Gradle init script hooks into `compileDebugKotlin` (and `compileDebugJavaWithJavac` if present). After compilation:

1. Copies original `.class` files to `build/harness-coverage/original-classes-kotlin/` (needed for reports since instrumented classes have different bytecode)
2. Runs JaCoCo's `InstrumentTask` to rewrite `.class` files with coverage probes
3. Copies `jacococli.jar` to `build/harness-coverage/` so it's available at report time without needing Gradle

### Runtime

`CoverageInitProvider` (a `ContentProvider`) bootstraps `CoverageHelper.setup()` before any Activity starts. The helper:

- Writes coverage data to `context.filesDir/coverage-{pid}.ec` every 1 second via a daemon timer
- Also flushes on `onActivityStopped`

Each app restart (the harness restarts per test suite) gets its own `.ec` file keyed by PID.

### Collection

The coverage collector pulls `.ec` files from the device by copying them to `/data/local/tmp/` via `adb shell run-as`, then using `adb pull` (which handles binary data correctly). It then uses `jacococli.jar` from the build output to merge and generate reports.

## Troubleshooting

### "Original class files not found"

The build output wasn't found at test time. Make sure:
- You built with `--init-script` and the correct `-PHarnessCoverageModules`
- The `modules` in `rn-harness.config.mjs` match the Gradle module paths
- If build and test run on different machines, transfer the entire `<module>/build/harness-coverage/` directory

### "jacococli.jar not found"

Same as above — the init script stashes `jacococli.jar` during the build. If it's missing, the build didn't use the init script.

### "No .ec files found on device"

The app didn't write coverage data. Check:
- Was the app built with the init script? (`javap -p ... | grep jacoco`)
- Did the app actually run? (check adb logcat for `HarnessCoverage` tag)
- Is `BuildConfig.COVERAGE_ENABLED` true?

### 0% coverage on everything

The `.ec` data doesn't match the class files. This happens when you rebuild without re-running tests, or vice versa. Always use matching build + test runs.

### `EROFS` crash on startup

Missing `jacoco-agent.properties` with `output=none`. The init script injects this automatically — if you see this error, the init script wasn't applied correctly.
