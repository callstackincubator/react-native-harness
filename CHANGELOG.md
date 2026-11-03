## 1.7.0 (2026-11-03)

### 🚀 Features

- Failed assertions now print a `- Expected` / `+ Received` diff below the error ([#202](https://github.com/callstackincubator/react-native-harness/pull/202))
  message, the same way Vitest shows them. This works for regular assertions and
  for every failed `expect.soft` call. Plugins can read the diff from the new
  optional `diff` field on test errors.

- Run diagnostics now include resource telemetry. Set `diagnostics` to `true` or to an object (`enabled`, `probes`, `sampleIntervalMs`) to sample host load, CPU and memory pressure, Harness process memory and event loop lag, per-milestone process listings on macOS, and the process count and last boot stage of iOS simulators. Entries are written to `.harness/diagnostics/<sessionId>.jsonl` as the run progresses, so cancelled or timed-out CI jobs keep their data. Metrics appear as graphed tracks in the Perfetto trace, and a key-number summary (boot wait, time to ready, peak load, peak compressed memory, swapouts, event loop lag) is printed, saved to `<runId>.summary.json` and added to the GitHub Actions job summary. ([#205](https://github.com/callstackincubator/react-native-harness/pull/205))
- iOS runs no longer compile the permission helper from scratch. Harness now uses the prebuilt XCTest agent that ships with the Apple platform package, so a run reaches a ready agent in about a second instead of waiting on an Xcode build, and CI no longer needs to cache that build. The shipped agent works from Xcode 26 up to the Xcode version a release was packed with; on any other Xcode, Harness builds it locally as before. Set `HARNESS_IOS_XCTEST_PREBUILT_ROOT` to point at artifacts packed elsewhere, or `HARNESS_SKIP_XCTEST_PREBUILDS=1` to always build locally. ([#209](https://github.com/callstackincubator/react-native-harness/pull/209))

  Physical devices now sign a shipped artifact locally instead of building one. A runnable device build has to carry your own certificate and a profile that lists your device, so Harness takes the unsigned artifact and re-signs a private copy with a certificate picked by matching your profile against your keychain — offline, in about a second. It selects a profile only when that profile covers the agent's bundle ids and your device and has not expired, and otherwise builds locally as before, which remains the path that can reach the Developer Portal. If your account cannot issue a profile covering the agent's identifiers, set `device.codeSign.bundleIdPrefix` to rewrite them to your own prefix; if your keychain holds several development certificates, set `device.codeSign.signingIdentity` to one SHA-1, since `codesign` rejects the ambiguous name.

- In Jest's CI mode (on by default in CI), `toMatchImageSnapshot` fails when its snapshot does not exist instead of writing it and passing, and saves the received image as `__diff_output__/<name>-actual.png`. A project whose CI relied on missing snapshots being written commits those images as its snapshots, or runs with `--ci=false` on a machine with the comparing device. Like Jest's own snapshot matchers, `toMatchImageSnapshot` cannot be used with `.not`. ([#249](https://github.com/callstackincubator/react-native-harness/pull/249), [#198](https://github.com/callstackincubator/react-native-harness/issues/198), [#227](https://github.com/callstackincubator/react-native-harness/issues/227), [#298](https://github.com/callstackincubator/react-native-harness/issues/298))
- On Android 8 and later, `screen.screenshot()` captures what a TextureView or a SurfaceView shows, such as a GPU-rendered canvas, a video or a camera preview, instead of transparent pixels. An on-screen capture now copies what the window shows, so effects only the GPU renderer draws, such as elevation shadows and `filter` blurs, appear in it, and an Android baseline recorded without them needs recording again; a capture whose copy fails, or whose window is not shown, as while the screen is off, resolves `null` instead of a different image. An element under a scale or rotation transform is captured in the box it covers on the screen, as on iOS. An element partly off the screen, scaled to nothing or detached from the window is still drawn by itself, at its scroll offset, so a TextureView or a SurfaceView in it still comes out transparent; on Android 8.0 and 8.1 a window with elevation is drawn from its view tree, as before, with its SurfaceViews behind it; and a SurfaceView set above its window with `setZOrderOnTop` is still left out. ([#257](https://github.com/callstackincubator/react-native-harness/pull/257), [#197](https://github.com/callstackincubator/react-native-harness/issues/197))
- `@react-native-harness/tools` now exposes a `ProcessManager` on the Harness ([#269](https://github.com/callstackincubator/react-native-harness/pull/269), [#166](https://github.com/callstackincubator/react-native-harness/issues/166))
  context through `getProcessManager()`. Tests can inject the scripted
  `createFakeProcessManager()` from `@react-native-harness/tools/testing` to
  answer commands by name and arguments, assert on the calls made, and simulate
  failures without running real processes.


### 🩹 Fixes

- On Android, capturing a screenshot of a region now covers exactly the pixels of a view laid out at the same position and size. Previously, fractional pixel densities could make the region one pixel smaller than the matching element capture. ([#289](https://github.com/callstackincubator/react-native-harness/pull/289), [#280](https://github.com/callstackincubator/react-native-harness/issues/280))
- On CI, Harness now warns (and adds a GitHub Actions annotation) when the runner is already saturated before the run starts, naming the busiest processes. When the platform does not become ready in time, the error reports the peak load, average idle CPU, minimum free memory and swapped-out memory observed during startup, and says when the host was starved instead of suggesting a larger timeout. On iOS simulator hosts with 3 cores or less than 8 GB of memory, the Metro prewarm now starts after the simulator has booted instead of competing with it. On CI hosts with 3 cores or less than 8 GB, Harness now stops the iOS simulator's background services that tests do not use (photo analysis, widgets, Siri, iCloud sync) right after boot, which cuts the time until the simulator is ready from several minutes to about two. Turn this on or off with the `slimOnCI` option of `appleSimulator()`. ([#295](https://github.com/callstackincubator/react-native-harness/pull/295))
- Every iOS `screen.screenshot()` capture (full screen, region, and element, whether fully or partly on screen) is now 8-bit sRGB. Previously, on wide-colour devices and simulators, the on-screen capture paths produced 16-bit Display P3 images, so the same colour could differ depending on how it was captured. iOS image snapshots recorded on wide-colour devices will need to be re-recorded. ([#291](https://github.com/callstackincubator/react-native-harness/pull/291), [#281](https://github.com/callstackincubator/react-native-harness/issues/281))
- On CI hosts with 3 cores or less than 8 GB of memory, Harness now keeps the iOS simulator's unused background services from starting when it boots the simulator, instead of stopping them after the boot has already paid for them. It also turns off more of them, including wallpapers, Spotlight and on-device intelligence. Push notifications, StoreKit, in-app purchases and universal links keep working, and services the simulator needs to boot or to launch apps under XCTest are left on. A simulator that is already booted when Harness starts is now left as it is. ([#304](https://github.com/callstackincubator/react-native-harness/pull/304))
- Screenshots received for `toMatchImageSnapshot` are now removed from the system temp folder once the comparison finishes, instead of accumulating with every run. ([#286](https://github.com/callstackincubator/react-native-harness/pull/286), [#276](https://github.com/callstackincubator/react-native-harness/issues/276))
- On Android and iOS, `screen.screenshot()` of an element that has zero size or is no longer available now returns `null` instead of capturing the whole window. ([#290](https://github.com/callstackincubator/react-native-harness/pull/290), [#279](https://github.com/callstackincubator/react-native-harness/issues/279))
- The Android platform now works when Harness runs on a Windows host. Harness ([#192](https://github.com/callstackincubator/react-native-harness/pull/192), [#191](https://github.com/callstackincubator/react-native-harness/issues/191), [#183](https://github.com/callstackincubator/react-native-harness/issues/183))
  finds the SDK's `adb.exe`, `emulator.exe`, `sdkmanager.bat` and
  `avdmanager.bat`, looks in `%LOCALAPPDATA%\Android\Sdk` when `ANDROID_HOME` is
  not set, and installs SDK packages and creates emulators without needing
  `bash`.

- The connection between the Harness CLI and the app now sends screenshot data in flow-controlled chunks on its own channel, with test events and heartbeats sent ahead of it. The CLI and the app runtime must use the same Harness version. ([#203](https://github.com/callstackincubator/react-native-harness/pull/203))
- When the app crashes, disconnects, or stops responding in the middle of a test ([#204](https://github.com/callstackincubator/react-native-harness/pull/204), [#1695](https://github.com/callstackincubator/react-native-harness/issues/1695))
  file, the failure now names the test that was running, for example
  `Running test: "TestObjectCpp › thisObject returns a HybridObject of the same type"`.
  Failures outside a test, such as during startup or in `beforeAll`, keep their
  current message.

- Harness runs use less CPU. Jest now builds its file map in a single process instead of starting a pool of worker processes on every cold start or file change, and it no longer indexes Harness's `.harness` cache or iOS and Android build output (`ios/Pods`, `ios/build`, `android/build`, `android/.gradle`, `android/app/build`, `android/app/.cxx`). Jest also finds files without watchman, which is now faster than querying it; Metro still uses watchman. ([#206](https://github.com/callstackincubator/react-native-harness/pull/206))
- Harness now starts correctly in monorepos that contain more than one copy of `react-native`. Previously React Native's `InitializeCore` could be silently skipped, so the app failed at startup with `ReferenceError: Property 'window' doesn't exist` and Harness timed out waiting for it to become ready. ([#207](https://github.com/callstackincubator/react-native-harness/pull/207))
- Android app launches now restore port forwarding, allowing test runs to recover when ADB reverse mappings disappear between test files or startup retries. ([#211](https://github.com/callstackincubator/react-native-harness/pull/211), [#210](https://github.com/callstackincubator/react-native-harness/issues/210))
- When a platform runner or Metro itself fails while Metro is starting, Harness reports that error instead of exiting on an unhandled `AbortError`, and an aborted run stops waiting for Metro at once. ([#251](https://github.com/callstackincubator/react-native-harness/pull/251), [#200](https://github.com/callstackincubator/react-native-harness/issues/200))
- `react-native-harness --metroPort <port>` is accepted on the command line, as documented, instead of stopping on an unrecognized option, and a port the config would reject stops the run before it starts. ([#250](https://github.com/callstackincubator/react-native-harness/pull/250), [#199](https://github.com/callstackincubator/react-native-harness/issues/199))
- Use @react-native-harness/ui in iOS apps built with React Native SwiftPM integration without a local package patch. ([#213](https://github.com/callstackincubator/react-native-harness/pull/213), [#212](https://github.com/callstackincubator/react-native-harness/issues/212))
- In a monorepo where the app has its own copy of `react-native` or `react`, Harness's own packages and the packages its runtime depends on now import `react-native` and `react` from the app, so the bundle no longer carries a second React Native with a registry of its own, or a second React. A native component a test registers with `requireNativeComponent` now renders instead of failing with `View config getter callback ... must be a function`. ([#252](https://github.com/callstackincubator/react-native-harness/pull/252), [#215](https://github.com/callstackincubator/react-native-harness/issues/215), [#227](https://github.com/callstackincubator/react-native-harness/issues/227), [#207](https://github.com/callstackincubator/react-native-harness/issues/207))
- iOS simulator runs on Xcode 27 now install the app from `HARNESS_APP_PATH` when it is not already installed. Previously the run failed during startup with `AbortError: The operation was aborted`. ([#224](https://github.com/callstackincubator/react-native-harness/pull/224), [#223](https://github.com/callstackincubator/react-native-harness/issues/223))
- Large test files no longer fail with `app heartbeat timed out` while the app evaluates them. Harness now checks the app connection with WebSocket pings, which the app answers natively even while its JS thread is busy, and limits how long the JS thread may be blocked by the timeouts you already configure: `testTimeout` plus 5 seconds for a test or a `beforeAll`/`afterAll` hook, `bundleStartTimeout` while a setup file or test file loads, and 20 seconds otherwise. When the JS thread stays blocked longer, the error names the test, hook, or file, and `testTimeout` now also applies to tests and hooks that block the JS thread synchronously. The CLI and the app runtime must use the same Harness version. ([#226](https://github.com/callstackincubator/react-native-harness/pull/226), [#184](https://github.com/callstackincubator/react-native-harness/issues/184))
- Large test files no longer block the app's JS thread for the whole time it takes to parse them. Harness now evaluates test bundles in parts and lets the app respond between them, so the size of a test file's dependencies no longer affects whether a run passes. Stack traces and code frames for test failures still point at the right files and lines. ([#226](https://github.com/callstackincubator/react-native-harness/pull/226), [#184](https://github.com/callstackincubator/react-native-harness/issues/184))
- Harness test files and setup files now load correctly when running Jest on Windows. File names sent to the device and reported to plugins always use forward slashes. ([#240](https://github.com/callstackincubator/react-native-harness/pull/240), [#216](https://github.com/callstackincubator/react-native-harness/issues/216))
- iOS test runs no longer wait out the full startup timeout when the XCTest agent's `xcodebuild` process exits before the agent becomes ready. Harness now fails immediately with the exit code or signal. ([#234](https://github.com/callstackincubator/react-native-harness/pull/234), [#231](https://github.com/callstackincubator/react-native-harness/issues/231))
- Timeout errors for tests and suite hooks now reliably list the pending promise a hung test is waiting on, even when that promise is no longer referenced anywhere. ([#235](https://github.com/callstackincubator/react-native-harness/pull/235), [#217](https://github.com/callstackincubator/react-native-harness/issues/217))
- Failed image snapshot comparisons no longer overwrite other snapshots. The diff and actual images are now saved in a `__diff_output__` folder next to the baselines, so a snapshot named `code` failing can no longer replace the baseline of a snapshot named `code-diff`. ([#288](https://github.com/callstackincubator/react-native-harness/pull/288), [#274](https://github.com/callstackincubator/react-native-harness/issues/274))
- Waiting for a device lock on Windows no longer fails when another run is deleting a lock file, and releasing a lock no longer leaves a stale lock behind that blocks the next run. ([#236](https://github.com/callstackincubator/react-native-harness/pull/236), [#218](https://github.com/callstackincubator/react-native-harness/issues/218))
- The react-native-harness Jest preset now resolves on Windows, fixing "Preset react-native-harness not found" errors. ([#237](https://github.com/callstackincubator/react-native-harness/pull/237), [#15961](https://github.com/callstackincubator/react-native-harness/issues/15961), [#222](https://github.com/callstackincubator/react-native-harness/issues/222))
- iOS screenshots use a generated native signature that supports omitted bounds for full-window captures. iOS builds no longer warn about conflicting screenshot parameter types or deprecated window lookup. ([#256](https://github.com/callstackincubator/react-native-harness/pull/256), [#253](https://github.com/callstackincubator/react-native-harness/issues/253))
- On Windows, the Android runner can now accept SDK licenses, install missing SDK packages, and create emulators, because `sdkmanager.bat` and `avdmanager.bat` receive their arguments intact. ([#264](https://github.com/callstackincubator/react-native-harness/pull/264), [#259](https://github.com/callstackincubator/react-native-harness/issues/259), [#117](https://github.com/callstackincubator/react-native-harness/issues/117))
- Harness now respects `ANDROID_AVD_HOME` when it is set, instead of always looking for Android emulators in `~/.android/avd`. ([#263](https://github.com/callstackincubator/react-native-harness/pull/263), [#260](https://github.com/callstackincubator/react-native-harness/issues/260))
- `toMatchImageSnapshot` now saves the received image as `__diff_output__/<name>-actual.png` when ([#287](https://github.com/callstackincubator/react-native-harness/pull/287), [#275](https://github.com/callstackincubator/react-native-harness/issues/275))
  the screenshot and the snapshot have different dimensions, so it is available
  for inspection and in the visual test diffs artifact.

- The GitHub action no longer reports cache-save failures after successful runs. iOS runs without the XCTest agent skip saving the missing XCTest cache, and Android runs wait for the emulator to exit before archiving the AVD cache. ([#266](https://github.com/callstackincubator/react-native-harness/pull/266), [#254](https://github.com/callstackincubator/react-native-harness/issues/254))
- Harness reports unexpected native test-host replacement, fails the interrupted file, and restarts the app before subsequent files run. ([#272](https://github.com/callstackincubator/react-native-harness/pull/272), [#271](https://github.com/callstackincubator/react-native-harness/issues/271))
- On smaller machines such as standard GitHub macOS runners, Harness now waits ([#267](https://github.com/callstackincubator/react-native-harness/pull/267), [#189](https://github.com/callstackincubator/react-native-harness/issues/189))
  briefly for a freshly booted iOS simulator to become responsive before
  launching the app, which reduces slow or flaky first launches.

- `toMatchImageSnapshot` now fails with a message naming the snapshot when `screen.screenshot()` could not capture an image, instead of a `TypeError` about reading `data` of `null`. ([#270](https://github.com/callstackincubator/react-native-harness/pull/270))
- The iOS permission prompt watcher now costs less on small machines. It only checks for system prompts while the app under test is in the foreground, looks for a system alert before searching for buttons, and ticks every 2 seconds by default on constrained hosts. Set `HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS` to override the interval. ([#268](https://github.com/callstackincubator/react-native-harness/pull/268), [#188](https://github.com/callstackincubator/react-native-harness/issues/188))
- Watch mode no longer hangs on "waiting in queue" for the second and later runs; the device session is now reused between runs instead of blocking on its own lock. ([#292](https://github.com/callstackincubator/react-native-harness/pull/292), [#282](https://github.com/callstackincubator/react-native-harness/issues/282))
- The web runner now installs browsers on Node.js 26 by requiring Playwright 1.60 or newer. ([#233](https://github.com/callstackincubator/react-native-harness/pull/233), [#230](https://github.com/callstackincubator/react-native-harness/issues/230))
- Running the same test file repeatedly against a live app, as watch mode does, no longer fails from the third run onward with "Your test suite must contain at least one test". ([#292](https://github.com/callstackincubator/react-native-harness/pull/292), [#282](https://github.com/callstackincubator/react-native-harness/issues/282))
- Errors from failed commands now include the last lines of what the command printed, so the reason for the failure is visible without enabling debug logs. ([#243](https://github.com/callstackincubator/react-native-harness/pull/243), [#228](https://github.com/callstackincubator/react-native-harness/issues/228))

### ❤️ Thank You

- Claude
- Dave Mkpa-Eke @DaveyEke
- HyunWoo Lee (Nunu Lee) @l2hyunwoo
- Marc Rousavy @mrousavy
- Szymon Chmal @V3RON
- YevheniiKotyrlo @YevheniiKotyrlo

## 1.6.0 (2026-10-16)

### 🚀 Features

- The Vega runner now works with current Vega SDKs (0.24 and newer): it drives the `vega` CLI instead of the retired `kepler` binary, starts the Vega Virtual Device when it is not running, supports Fire TV devices in developer mode through `vegaPhysicalDevice(serial)`, installs the app package from `HARNESS_APP_PATH`, forwards Metro's port to the device, captures device logs for failed runs, and configures Metro for React Native for Vega (`kepler` platform, the `@amazon-devices/react-native-kepler` redirect, and Amazon's system bundles so React Native comes from the OS copy). Platforms can also declare a `bundlePlatform` when the app requests Metro bundles under a different platform name than the harness platform id, the runtime no longer depends on a URL polyfill that reads the legacy native module bridge, so it initializes on bridgeless runtimes such as Vega, and test bundles may use string module ids from custom Metro id factories. ([#196](https://github.com/callstackincubator/react-native-harness/pull/196), [#195](https://github.com/callstackincubator/react-native-harness/issues/195))

### ❤️ Thank You

- Hristo Totov @hristototov

## v1.5.0 (2026-09-14)

### 🚀 Features

- Add an injectable filesystem context and in-memory filesystem helper for hermetic Harness integrations and tests. ([#169](https://github.com/callstackincubator/react-native-harness/pull/169), [#165](https://github.com/callstackincubator/react-native-harness/issues/165))
- The `react-native-harness` CLI now exposes `harness ci <subcommand>` ([#185](https://github.com/callstackincubator/react-native-harness/pull/185))
  (`load-config`, `plan-metro-restore`, `snapshot-metro`, `plan-metro-save`),
  which the official GitHub Action uses to run its configuration and Metro
  caching steps through your project's own installed CLI instead of bundled
  scripts checked into the action. As a result, the action now requires a
  `react-native-harness` install that supports this interface — it checks
  this itself via a capability marker on the installed package rather than a
  version number, and fails clearly when the installed CLI predates it. Keep
  the action ref and the `react-native-harness` package version in sync, as
  already recommended.

- Platform packages can now adjust the Metro configuration Harness composes for ([#190](https://github.com/callstackincubator/react-native-harness/pull/190), [#187](https://github.com/callstackincubator/react-native-harness/issues/187))
  their runner, through a `metroConfigEnhancer` module they point at. The bundler
  wiring a platform's runtime needs — module resolution redirects, additional
  resolver platforms, its own core initialization — lives in the platform package
  instead of in the bundler. Nothing changes for platforms that do not set one.


### 🩹 Fixes

- Harness now bounds owned CLI processes so cancelled runs do not leave console, logcat, or XCTest children behind. ([#181](https://github.com/callstackincubator/react-native-harness/pull/181))
- Skipped tests now appear as skipped in Jest output and compatible result consumers. ([#182](https://github.com/callstackincubator/react-native-harness/pull/182))
- The harness now runs on a Windows host and recognizes React Native Windows as a device platform: ESM (`rn-harness.config.mjs`) configs load correctly when the harness process runs on Windows, and an app reporting `Platform.OS === 'windows'` completes the bridge handshake instead of failing with "Unsupported platform". ([#187](https://github.com/callstackincubator/react-native-harness/pull/187))
- The `@react-native-harness/platform-windows` package now supplies its own Metro wiring through the `metroConfigEnhancer` hook: the `react-native` -> `react-native-windows` resolver redirect, the `windows` and `native` `resolver.platforms` entries, and React Native Windows' `InitializeCore`. A `windowsPlatform()` runner no longer needs any of this hand-added to `metro.config.js`, and `@react-native-harness/bundler-metro` no longer reads `@react-native-community/cli-config` to detect out-of-tree platforms. iOS and Android runs are unaffected. ([#187](https://github.com/callstackincubator/react-native-harness/pull/187))
- New `@react-native-harness/platform-windows` package: run harness tests against a deployed React Native Windows app. Add `windowsPlatform({ name, packageName })` to `rn-harness.config.mjs` — the runner resolves the package family name via `Get-AppxPackage`, shell-activates the app by its AUMID, and tracks it by process name. Requires the app to be deployed first (`react-native run-windows`). ([#187](https://github.com/callstackincubator/react-native-harness/pull/187))
- A resource-lock heartbeat refresh that fails to write (for example the owner file racing a concurrent release, or a transient filesystem error) is now swallowed instead of surfacing as an unhandled rejection — the lock simply goes stale and is reclaimed, as it already would if the refresh were missed. ([#187](https://github.com/callstackincubator/react-native-harness/pull/187))
- The resource lock a platform runner defines via `getResourceLockKey` is now honored. Concurrent Harness runs that target the same platform but different devices — two iOS simulators, or an emulator and a physical device — no longer queue behind each other; only runs that share a device wait. Previously the key was silently dropped by config validation and every run of a platform serialized on `<platformId>:<runnerName>`. ([#187](https://github.com/callstackincubator/react-native-harness/pull/187))

### ❤️ Thank You

- Marc Rousavy @mrousavy
- Stanislav Doskalenko @StasDoskalenko
- Szymon Chmal @V3RON

## 1.4.1 (2026-08-04)

### 🩹 Fixes

- Published packages exclude test outputs and local build artifacts. ([#179](https://github.com/callstackincubator/react-native-harness/pull/179))
- Harness tracks pending work while preserving native Promise instances so native modules return their settled values on Hermes. ([#180](https://github.com/callstackincubator/react-native-harness/pull/180))

### ❤️ Thank You

- Szymon Chmal @V3RON

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
