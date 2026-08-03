## 1.4.0 (2026-08-03)

### 🚀 Features

- Harness now offers experimental native iOS coverage for selected CocoaPods, so you can see which native code paths your Harness tests exercise. After a covered run, Harness produces `native-coverage.lcov`, giving you a concrete way to inspect and report native coverage alongside your existing test results. ([#83](https://github.com/callstackincubator/react-native-harness/pull/83))
- Harness test files can now opt into platform-specific execution by suffixing the file name with a known platform, while shared harness tests continue to run everywhere. When you run Harness for a specific runner, files for other known platforms are filtered out before Jest schedules them, so `*.ios.harness.*` and `*.android.harness.*` tests can live side by side without failing on the wrong platform. ([#134](https://github.com/callstackincubator/react-native-harness/pull/134))
- Harness runs can now emit detailed diagnostics: enable them with the new `diagnostics` config option (or `RN_HARNESS_DIAGNOSTICS` env var) to get a Chrome Trace Event JSON file plus a console summary showing where time went during a run — session setup, Metro bundling, bridge/device round-trips, and per-file test execution. Load the trace directly in `chrome://tracing` or Perfetto. Diagnostics are off by default with zero overhead. ([#148](https://github.com/callstackincubator/react-native-harness/pull/148))
- `resetEnvironmentBetweenTestFiles` now accepts `'runtime'` as a faster alternative to a full app restart between test files. Instead of relaunching the app, the runtime is reset in place, which noticeably speeds up suites with many test files while keeping each file isolated. Existing `true`/`false` settings keep working as before. ([#154](https://github.com/callstackincubator/react-native-harness/pull/154))
- The official GitHub Action now computes the Metro cache key itself instead of hashing a static file list: it accounts for your lockfile(s), Metro/Babel config, the resolved `@react-native-harness/bundler-metro` version, and your `cache.version` salt, so the cache invalidates automatically when you upgrade Metro, not only when a lockfile or config file changes. A new `cacheSavePolicy` action input (`'default-branch'` by default, or `'always'`/`'never'`) controls when a new cache entry is saved, and a run only saves a new entry when its cache contents actually changed. ([#161](https://github.com/callstackincubator/react-native-harness/pull/161), [#160](https://github.com/callstackincubator/react-native-harness/issues/160))
- Harness now starts building the Metro bundle as soon as the Metro server is up, instead of waiting for the emulator/simulator to finish booting first. On cold starts, bundling now overlaps platform boot instead of happening after it, cutting wall-clock time by up to the full first-bundle build duration. Startup stall errors are also more actionable, distinguishing device-side connectivity issues from a slow or broken bundle build. A new `eagerPrewarm` config option (default `true`) lets you opt out on constrained runners where emulator boot and bundling might contend for CPU. ([#149](https://github.com/callstackincubator/react-native-harness/pull/149))
- Metro's transform and file-map caches now persist under `.harness/cache/metro` and `.harness/cache/metro-file-map` in your project root, enabled by default, so repeated Metro runs and CI jobs reuse work instead of rebuilding from scratch. Configure this with the new `cache.metro` and `cache.version` options; the previous `unstable__enableMetroCache` flag still works but is deprecated in favor of `cache.metro`. The official GitHub Action restores and saves the new cache paths automatically. ([#160](https://github.com/callstackincubator/react-native-harness/pull/160))
- Test files now load faster, since Harness no longer resends code your app already has. This was previously an experimental opt-in and is now enabled by default; the old experimental flag still works but is deprecated in favor of the new `skipAlreadyIncludedModules` option. ([#158](https://github.com/callstackincubator/react-native-harness/pull/158))

### 🩹 Fixes

- Using expect.soft will no longer throw an internal exception. ([#105](https://github.com/callstackincubator/react-native-harness/pull/105))
- Add the `permissions` config flag for cross-platform permission automation, using the iOS XCTest agent for prompt auto-accept and Android `adb pm grant` for requested dangerous permissions. ([#106](https://github.com/callstackincubator/react-native-harness/pull/106))
- Harness will stop trying to treat connected physical Android devices as emulators. If you run against an Android emulator and also have a physical device plugged in, Harness will now pick the emulator cleanly instead of failing during device resolution. ([#112](https://github.com/callstackincubator/react-native-harness/pull/112))
- Harness now lets you target connected physical iOS devices by hardware UDID as well as by device name or CoreDevice identifier, which makes it easier to select the exact device when multiple phones share similar names. ([#113](https://github.com/callstackincubator/react-native-harness/pull/113))
- When `forwardClientLogs` is enabled, Harness continues attaching device `console` output to the active test result, while keeping the internal log-capture path simpler and easier to maintain. ([#115](https://github.com/callstackincubator/react-native-harness/pull/115))
- Harness now lets you build the iOS XCTest agent binary directly from the CLI, without starting a Harness test run. This makes it easier to prepare the agent artifact ahead of time for external injection workflows. ([#117](https://github.com/callstackincubator/react-native-harness/pull/117))
- Harness on iOS can now start from an externally prepared `.xctestrun` and derived data directory, so you can run XCTest-based flows on hosted device infrastructure without rebuilding the agent on the runner. ([#116](https://github.com/callstackincubator/react-native-harness/pull/116))
- Harness on web can now pass Playwright launch arg overrides through the browser config, so you can turn off defaults like `--enable-automation` without forking the runner. ([#119](https://github.com/callstackincubator/react-native-harness/pull/119))
- Harness now keeps the browser's native `Event` and `EventTarget` on web, while still applying the shim where React Native needs it, so web users no longer lose native DOM behavior. ([#122](https://github.com/callstackincubator/react-native-harness/pull/122))
- Harness test callbacks now consistently receive a `HarnessTestContext` in `test`, `it`, `beforeEach`, and `afterEach`, exposing task metadata, dynamic skipping with `context.skip(...)`, and per-test `onTestFinished` / `onTestFailed` lifecycle hooks. ([#125](https://github.com/callstackincubator/react-native-harness/pull/125))
- Harness now handles app bridge reloads, reconnects, disconnects, and dropped sockets more reliably during test runs. For Harness users, this means fewer stuck runs waiting on a dead RPC channel and clearer failures when the app reloads, crashes, or loses its bridge connection mid-test. ([#132](https://github.com/callstackincubator/react-native-harness/pull/132))
- Harness test events now include richer per-test context, so end-users can skip or react to individual tests more reliably and get clearer pass/fail reporting from the runner. ([#131](https://github.com/callstackincubator/react-native-harness/pull/131))
- Crash detection now uses app sessions with native crash evidence, so users get faster, clearer failure reports and more reliable diagnosis on real devices. ([#133](https://github.com/callstackincubator/react-native-harness/pull/133))
- Harness test runs keep Metro and the device responsive together, reducing slowdowns on larger development machines while preserving small CI runner behavior. ([#152](https://github.com/callstackincubator/react-native-harness/pull/152), [#151](https://github.com/callstackincubator/react-native-harness/issues/151))
- The iOS permission-dialog watchdog now uses far less CPU, and its polling interval is tunable via HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS. ([#163](https://github.com/callstackincubator/react-native-harness/pull/163))
- Android Harness runs now use more of the CPU available on larger machines, making local emulator tests faster without changing behavior on small CI runners. ([#151](https://github.com/callstackincubator/react-native-harness/pull/151))
- Fixes a hang where the harness process kept running after tests finished whenever diagnostics were enabled (via the `diagnostics` config option or `RN_HARNESS_DIAGNOSTICS`). Diagnostics instrumentation replaced subprocess handles returned by adb/simctl with plain promises, so teardown could no longer kill the background `adb logcat` / app-launch processes and they kept the harness alive. Instrumented calls now return the original subprocess handles untouched, so runs with diagnostics enabled terminate cleanly. ([#159](https://github.com/callstackincubator/react-native-harness/pull/159))
- Fixes a hang where the harness process never exits after tests finish, most common on Android and occasional on iOS. A stray WebSocket connection to Metro's dev server (e.g. a half-open HMR client) could prevent the server from shutting down, leaving Jest running indefinitely until it was killed manually or by a CI timeout. Metro now force-closes any lingering connections when the harness tears down, so runs terminate reliably and Ctrl+C/SIGTERM work as expected. ([#155](https://github.com/callstackincubator/react-native-harness/pull/155))
- Fixes an unbounded memory leak that OOM'd the Harness runner on suites with many test files. Each test file is fetched from Metro as its own bundle entry point, and Metro keeps a full dependency graph in memory per entry for delta updates — so the harness retained one graph (~tens of MB) per test file for the whole run, climbing until `JavaScript heap out of memory`. The runtime now releases each file's Metro graph once the file finishes (via the dev server's standard graph-release request), keeping memory flat regardless of how many test files a run contains. ([#145](https://github.com/callstackincubator/react-native-harness/pull/145), [#144](https://github.com/callstackincubator/react-native-harness/issues/144))
- Fixes Metro prewarm so it actually warms the graph the app requests. On Expo projects, the prewarm request was missing several transform/query params the app's real bundle request uses, so the prewarmed graph was essentially always thrown away and rebuilt from scratch; on bare React Native it was missing `lazy=true`. Both client types now request byte-identical bundle URLs, so the prewarm work is no longer wasted, and a new guard logs a warning if the two URLs ever drift apart again. ([#150](https://github.com/callstackincubator/react-native-harness/pull/150))
- Fixes an unbounded memory leak in the runtime promise tracker that could exhaust the JS heap (`JavaScript heap out of memory`) during long runs. Apps that keep producing work every frame (animations, `requestAnimationFrame` loops, polling, async data-binding) create a stream of promises that never settle; these were retained forever along with a captured stack, growing memory until the run crashed. Harness now releases a promise's tracking record as soon as the promise is garbage-collected and caps the number of retained records, so memory stays bounded regardless of how busy the app under test is. ([#143](https://github.com/callstackincubator/react-native-harness/pull/143), [#142](https://github.com/callstackincubator/react-native-harness/issues/142))
- Android E2E crash-detection logcat cleanup no longer surfaces an unhandled promise rejection during Harness shutdown, which previously crashed the whole test process. ([#162](https://github.com/callstackincubator/react-native-harness/pull/162))
- Harness now asks the iOS XCTest permission agent to stop gracefully when a test run ends, letting its session finish on its own before Harness falls back to terminating xcodebuild. This avoids cutting off an otherwise-passing agent session during teardown and leaves fewer stray simulator and xcodebuild processes behind after tests complete. ([#139](https://github.com/callstackincubator/react-native-harness/pull/139))
- Collapses the two competing subprocess shutdown mechanisms (the global process-level SIGINT/SIGTERM net in packages/tools/src/spawn.ts and the session's own abort-driven dispose) into one session-lifetime abort signal. Long-lived child processes (Android logcat, iOS launch process and XCTest agent, web browser, Vega app) now abort on session teardown through a single signal instead of racing a separate raw-kill handler. ([#164](https://github.com/callstackincubator/react-native-harness/pull/164), [#162](https://github.com/callstackincubator/react-native-harness/issues/162))
- Harness test runs now use markedly less memory while Metro bundles, and Metro configs keep the project's own `resolver.blockList` instead of having it discarded. ([#173](https://github.com/callstackincubator/react-native-harness/pull/173))
- Harness runs on iOS no longer linger for up to ~25 seconds after tests finish ([#176](https://github.com/callstackincubator/react-native-harness/pull/176))
  printing results. Uncancelled timers and abort listeners left over from
  internal `Promise.race` calls (XCTest agent shutdown, Android/iOS/Vega app
  session polling, and startup crash detection) could keep the process alive
  past test completion; they are now cleaned up as soon as the other side of
  the race settles.

- Harness commands now include the supported Jest CLI runtime, so the init command works when invoked through yarn dlx or npx. ([#168](https://github.com/callstackincubator/react-native-harness/pull/168))
- The web and Vega platforms start correctly again. Session setup previously threw `Cannot read properties of undefined (reading 'aborted')` because these runners received the harness config in place of their init options. ([#175](https://github.com/callstackincubator/react-native-harness/pull/175))
- Harness now adapts iOS permission-agent startup to the host's available memory ([#174](https://github.com/callstackincubator/react-native-harness/pull/174), [#171](https://github.com/callstackincubator/react-native-harness/issues/171))
  and CPU capacity, preserving build-first startup on constrained machines while
  overlapping safe preparation work on capable hosts.

- Harness now adapts iOS permission-agent startup to the host's available memory ([#174](https://github.com/callstackincubator/react-native-harness/pull/174), [#171](https://github.com/callstackincubator/react-native-harness/issues/171))
  and CPU capacity, preserving build-first startup on constrained machines while
  overlapping safe preparation work on capable hosts.

### ❤️ Thank You

- Claude Opus 4.7 (1M context)
- Hanno J. Gödecke
- Marc Rousavy @mrousavy
- Miklós Fazekas @mfazekas
- nachooya @nachooya
- Szymon Chmal
- Yuta Saito

## 1.1.0 (2026-04-13)

### 🚀 Features

- Metro bundler watch mode is now automatically disabled when running in a CI environment. ([#73](https://github.com/callstackincubator/react-native-harness/pull/73))
- Startup crash detection now monitors apps during launch and reports crashes before the first test even begins, with detailed diagnostics for both iOS and Android. On iOS, Harness prefers Apple diagnostic crash reports (including simulator `.ips` reports under DiagnosticReports) and device-side diagnostics from `devicectl` where available. Crash report selection on iOS simulators uses a more reliable algorithm that tolerates timing variations. ([#71](https://github.com/callstackincubator/react-native-harness/pull/71))
- Replaces the split Android/iOS/Web actions with a single composite action at the repository root (`callstackincubator/react-native-harness`). The action selects setup from your `rn-harness.config.mjs` runner, restores and saves `.harness/metro-cache` automatically, supports optional `preRunHook` and `afterRunHook` scripts, uploads crash artifacts from `.harness/crash-reports/`, and exposes Android AVD snapshot caching via `cacheAvd`. Older per-platform action entrypoints are deprecated in favor of the unified workflow. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Introduces a first-class plugin system: define hooks with `definePlugin()` from `@react-native-harness/plugins` and register them under `plugins` in `rn-harness.config.mjs`. Plugins can observe Harness, Metro, run, app, suite, and test lifecycle events for logging, artifacts, or custom automation. ([](https://github.com/callstackincubator/react-native-harness/commit/))

### 🩹 Fixes

- Metro cache is now stored under `.harness/metro-cache` in the project root. Set `unstable__enableMetroCache: true` in your config to use it; Harness will log when reusing the cache between runs. In CI, you can cache `.harness/metro-cache` to speed up Metro bundling. ([#74](https://github.com/callstackincubator/react-native-harness/pull/74))
- Harness now restores app startup stall recovery for RN-ready launches, including restart-between-files. Apps are retried when startup stalls without a crash, while confirmed native crashes still fail immediately with crash diagnostics. ([#78](https://github.com/callstackincubator/react-native-harness/pull/78))
- Harness now falls back to the next available Metro port when the configured port is already in use, which lets multiple Harness runs start at the same time without colliding on Metro. When this happens, Harness keeps the selected port consistent for the whole run and prints a message showing which port it ended up using. ([#96](https://github.com/callstackincubator/react-native-harness/pull/96))
- Mobile runners now fully disable native crash monitoring when `detectNativeCrashes` is set to `false`, including iOS simulators and Android emulators and physical devices. This keeps crash-monitor setup aligned with the runtime setting while preserving the existing default behavior of enabling native crash detection when the option is omitted. ([#94](https://github.com/callstackincubator/react-native-harness/pull/94))
- Physical iOS app launches now pass Harness launch arguments to `xcrun devicectl` without breaking JSON output collection. This prevents app launch arguments from being misinterpreted as `devicectl` flags and keeps device launches working when custom arguments are provided. ([#93](https://github.com/callstackincubator/react-native-harness/pull/93))
- Harness now queues concurrent runs before starting Metro when they target the same locked resource, such as the same simulator, device, or browser. Queueing is keyed by the platform resource lock rather than the configured Metro port, so runs using different ports still wait if they target the same resource. ([#91](https://github.com/callstackincubator/react-native-harness/pull/91))
- Improves Expo app startup and compatibility: Metro resolves package-style entry points before Harness rewrites, recognizes Expo’s virtual Metro entry during readiness checks, and aligns runtime bridge initialization with Expo’s Metro runtime and the React Compiler. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Adds `metroPort` to Harness config and `--metroPort` on the CLI so you can steer Metro and the in-process bridge together. The legacy `webSocketPort` option is ignored; bridge traffic uses the Metro port. When a run ends, Harness clears Android debug HTTP host and iOS simulator JS location overrides so the next normal dev-client or Metro launch is not left pointing at Harness. Includes a URL polyfill path used by the WebSocket bridge where the host runtime does not provide `URL` globally. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Refreshes the in-app Harness runner screen visuals and builds the test overlay against React Native 0.85+ APIs so the runtime UI stays compatible with current React Native releases. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Installs Android SDK and emulator-related tooling only when an Android flow actually needs it, so Apple-only or web-only workflows avoid unnecessary Android package setup. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Refreshes shared target resource locks atomically when renewing heartbeats, improving reliability when multiple Harness processes queue on the same simulator, device, or browser configuration. ([](https://github.com/callstackincubator/react-native-harness/commit/))

### ❤️ Thank You

- Hanno J. Gödecke
- Szymon Chmal @V3RON

# 1.0.0 (2026-03-11)

### 🩹 Fixes

- Add a new host option to rn-harness.config for Metro bind host, replacing HARNESS_METRO_BIND_HOST. ([#70](https://github.com/callstackincubator/react-native-harness/pull/70))
- Rewrites the implementation of the entry point resolver so it no longer mistakenly hijacks relative imports that originate from third-party packages instead of the root directory. ([#68](https://github.com/callstackincubator/react-native-harness/pull/68))

### ❤️ Thank You

- Hanno J. Gödecke
- Szymon Chmal

## 1.0.0-alpha.25 (2026-02-06)

### 🩹 Fixes

- Pre-warm Metro bundles to reduce startup time for tests. This improves responsiveness across the supported platforms and Jest runner. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Pre-warm Metro bundles to reduce startup time for tests. This improves responsiveness across the supported platforms and Jest runner. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Pre-warm Metro bundles to reduce startup time for tests. This improves responsiveness across the supported platforms and Jest runner. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Add support for resolving `tsconfig` path aliases in Metro. This helps apps that rely on TypeScript path mappings bundle correctly. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Pre-warm Metro bundles to reduce startup time for tests. This improves responsiveness across the supported platforms and Jest runner. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Pre-warm Metro bundles to reduce startup time for tests. This improves responsiveness across the supported platforms and Jest runner. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Pre-warm Metro bundles to reduce startup time for tests. This improves responsiveness across the supported platforms and Jest runner. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Pre-warm Metro bundles to reduce startup time for tests. This improves responsiveness across the supported platforms and Jest runner. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Support screenshots of elements larger than the viewport by capturing the full bounds of the element. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Pre-warm Metro bundles to reduce startup time for tests. This improves responsiveness across the supported platforms and Jest runner. ([](https://github.com/callstackincubator/react-native-harness/commit/))
- Support screenshots of elements larger than the viewport by capturing the full bounds of the element. ([](https://github.com/callstackincubator/react-native-harness/commit/))

## 1.0.0-alpha.24 (2026-01-26)

### 🩹 Fixes

- Enables collection of coverage data in monorepository scenarios through the new coverageRoot configuration option. ([#59](https://github.com/callstackincubator/react-native-harness/pull/59))
- Added support for web platform with all functionalities supported by the native equivalents, including UI testing capabilities. ([#62](https://github.com/callstackincubator/react-native-harness/pull/62))
- Added `forwardClientLogs` option to forward React Native logs to terminal during tests ([#63](https://github.com/callstackincubator/react-native-harness/pull/63))
- Add interactive Harness init wizard to guide users through setup and config. ([#60](https://github.com/callstackincubator/react-native-harness/pull/60))

### ❤️ Thank You

- Miklós Fazekas @mfazekas
- Sylvain Abadie
- Szymon Chmal @V3RON

## 1.0.0-alpha.23 (2026-01-19)

### 🩹 Fixes

- There was a change made by mistake to the package.json of the runtime package, resulting in broken release. This is now reverted back to normal. ([8b73b17](https://github.com/callstackincubator/react-native-harness/commit/8b73b17))

### ❤️ Thank You

- Szymon Chmal @V3RON

## 1.0.0-alpha.22 (2026-01-19)

### 🩹 Fixes

- Introduces UI testing capabilities with a new `@react-native-harness/ui` package that provides screen queries, user event simulation (press, type), and visual regression testing through `toMatchImageSnapshot`. This enables comprehensive component and integration testing with real device interactions, similar to React Testing Library but running on actual iOS and Android devices. ([#35](https://github.com/callstackincubator/react-native-harness/pull/35))

### ❤️ Thank You

- Szymon Chmal @V3RON

## 1.0.0-alpha.21 (2026-01-15)

### 🩹 Fixes

- Adds Object.hasOwn polyfill to the runtime package for JSC (JavaScriptCore) compatibility. ([#53](https://github.com/callstackincubator/react-native-harness/pull/53))
- Add automatic app restart functionality when apps fail to report ready within the configured timeout period, improving test reliability by recovering from startup failures. ([#55](https://github.com/callstackincubator/react-native-harness/pull/55))
- Added native crash detection during test execution that automatically detects when the app crashes, skips the current test file, and continues with the next test file after restarting the app. ([#56](https://github.com/callstackincubator/react-native-harness/pull/56))
- Bundling errors are now displayed in the CLI output, providing immediate feedback when build issues occur. ([#57](https://github.com/callstackincubator/react-native-harness/pull/57))

### ❤️ Thank You

- bheemreddy-samsara @bheemreddy-samsara
- manud99 @manud99
- Szymon Chmal @V3RON

## 1.0.0-alpha.20 (2026-01-07)

### 🩹 Fixes

- Added `webSocketPort` option to `rn-harness.config` (default 3001). This allows configuring the Bridge Server port, enabling usage of custom ports without rebuilding the application. ([#44](https://github.com/callstackincubator/react-native-harness/pull/44))
- The module mocking system has been rewritten to improve compatibility with different versions of React Native. Instead of fully overwriting Metro's module system, the new implementation surgically redirects responsibility for imports to Harness, allowing for better integration with various React Native versions while maintaining the same mocking capabilities. The module mocking API has been slightly modified as part of this rewrite. ([#49](https://github.com/callstackincubator/react-native-harness/pull/49))
- Fixed inconsistent Android device manufacturer and model matching. Some devices reported manufacturer and model information in non-lowercased form, which could cause device identification issues. Device information is now normalized to lowercase for consistent matching. ([#45](https://github.com/callstackincubator/react-native-harness/pull/45))
- Updated `chai` and `@vitest/expect` dependencies to resolve test crashes caused by Hermes not understanding bigint literals. ([#37](https://github.com/callstackincubator/react-native-harness/pull/37))
- Fixed HMR (Hot Module Replacement) initialization race condition by adding retry logic with delays when disabling HMR, ensuring Harness waits for HMR to be ready before proceeding. ([#38](https://github.com/callstackincubator/react-native-harness/pull/38))

### ❤️ Thank You

- bheemreddy-samsara @bheemreddy-samsara
- manud99 @manud99
- Szymon Chmal @V3RON

## 1.0.0-alpha.19 (2025-12-21)

### 🩹 Fixes

- ## Features ([](https://github.com/callstackincubator/react-native-harness/commit/))

  - Add support for expo-dev-client
    Enables development with Expo's development client for enhanced debugging capabilities
  - Guard against augmenting the Metro config twice
    Prevents duplicate Metro configuration modifications that could cause issues
  - Run Metro internally
    Integrates Metro bundler execution within the harness for better control

  ## Fixes

  - Add missing use-sync-external-store dependency
    Fixes runtime errors by including required React hook dependency

  ## Chores

  - Reduce install size
    Optimizes package dependencies to decrease installation footprint
  - Add GitHub Actions for Harness
    Sets up automated CI/CD workflows for the project

## [1.0.0-alpha.18] (2025-11-03)

### Features

- **Metro Caching** ([#23](https://github.com/callstackincubator/react-native-harness/pull/23)): Added support for Metro's transformation cache, helping in cases when Metro struggles with re-transforming the same files over and over.

- **Improved Timeout Handling** ([#24](https://github.com/callstackincubator/react-native-harness/pull/24)): Enhanced timeout handling to propagate timeouts not only to the initial bootstrapping process but also to all commands sent to the device.

- **Platform Architecture Refactor** ([#22](https://github.com/callstackincubator/react-native-harness/pull/22)): Introduced a major refactor of the Harness architecture, splitting the CLI package into several smaller packages. This makes it possible to create custom platform packages without modifying existing ones. The Metro integration has also been revamped to be more reliable in CI environments.

### Documentation

- **GitHub Actions Workflow Update** ([#25](https://github.com/callstackincubator/react-native-harness/pull/25)): Updated the example GitHub Actions workflow for iOS by adding a step to install Watchman, which dramatically speeds up the file-crawling process and makes Harness run much faster.

## [1.0.0-alpha.17] (2025-10-22)

### Features

- **Metro Regression Workaround** ([#21](https://github.com/callstackincubator/react-native-harness/pull/21)): Changed the way config is augmented to return an async function, working around a regression in Metro.

- **Migration Prompts** ([#19](https://github.com/callstackincubator/react-native-harness/pull/19)): Added migration guide to help users transition from the old CLI to the new Jest-based workflow. Users with unsupported configuration properties will be prompted to migrate.

### Bug Fixes

- **Bundle URL Fix** ([#20](https://github.com/callstackincubator/react-native-harness/pull/20)): Fixed incorrect URL with double slashes used during test bundling, which was causing failures due to changed behavior in React Native or Metro.

## [1.0.0-alpha.16] (2025-10-22)

### Features

- **Split Setup and Setup After Env** ([#18](https://github.com/callstackincubator/react-native-harness/pull/18)): Split setup files into separate setup and setup after environment phases for better control over test initialization.

- **UI Components Support** ([#17](https://github.com/callstackincubator/react-native-harness/pull/17)): Added basic support for testing UI components in React Native Harness, enabling component-level testing capabilities.

- **Jest Wrapper CLI** ([#16](https://github.com/callstackincubator/react-native-harness/pull/16)): Replaced custom CLI implementation with a Jest wrapper, providing better integration with the Jest ecosystem and improved compatibility.

- **Jest Preset Re-export** ([#15](https://github.com/callstackincubator/react-native-harness/pull/15)): Re-exported Jest preset from the main package for easier configuration and setup.

- **Watch Mode Performance** ([#14](https://github.com/callstackincubator/react-native-harness/pull/14)): Significantly improved watch mode speed, making the development experience faster and more responsive.

- **Code Frame Error Display** ([#13](https://github.com/callstackincubator/react-native-harness/pull/13)): Enhanced error reporting in Jest with code frames, making it easier to identify and fix issues by showing the exact location of errors in context.

- **Jest Globals Detection** ([#12](https://github.com/callstackincubator/react-native-harness/pull/12)): Added validation to throw errors when Jest globals are used, ensuring proper test isolation and preventing common testing pitfalls.

- **Coverage Support** ([#10](https://github.com/callstackincubator/react-native-harness/pull/10)): Implemented code coverage reporting capabilities.

- **Reset Environment Config** ([#11](https://github.com/callstackincubator/react-native-harness/pull/11)): Added `resetEnvironmentBetweenTestFiles` configuration property for better test isolation control.

- **Auto-apply Babel Plugins** ([#9](https://github.com/callstackincubator/react-native-harness/pull/9)): Babel plugins are now automatically applied, reducing manual configuration requirements.

- **Auto-inject Harness** ([#8](https://github.com/callstackincubator/react-native-harness/pull/8)): Harness is now automatically injected into the test environment, simplifying setup process.

- **Setup Files Support** ([#6](https://github.com/callstackincubator/react-native-harness/pull/6)): Added support for Jest setup files, allowing for better test environment configuration.

- **Harness-based Jest Runner** ([#4](https://github.com/callstackincubator/react-native-harness/pull/4)): Implemented a custom Jest runner built on the Harness architecture.
