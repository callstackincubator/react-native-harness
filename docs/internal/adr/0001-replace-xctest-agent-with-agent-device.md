# ADR-0001: Replace the custom iOS XCTest agent with agent-device

## Status

Accepted

## Date

2026-09-14

## Context

`permissions: true` on iOS is implemented by a Harness-owned XCUITest target
(`packages/platform-ios/xctest-agent`, ~470 lines of Swift) plus ~1.7k lines of
TypeScript that build it with `xcodebuild build-for-testing`, cache the
DerivedData under `.harness/cache/xctest-agent-simulator-*`, run it with
`test-without-building`, talk to it over an ad-hoc HTTP server, and tear it
down (`xctest-agent*.ts`, `xctest-command.ts`, `startup-strategy.ts`, the
`harness xctest build` CLI command, the action.yml cache steps). The agent does
one thing: poll SpringBoard every second and tap known positive buttons
(`Allow`, `OK`, `While Using the App`, ...) so permission prompts never block a
test.

This layer is expensive to keep: Xcode/SDK cache keys, signing for physical
devices, external `.xctestrun` injection for hosted device farms, graceful
shutdown races (#139, #164, #176), CPU tuning (#163). Every Xcode release is a
potential break, and it exists only for iOS while Android uses `adb pm grant`.

[agent-device](https://github.com/callstack/agent-device) (Callstack, MIT)
already owns a maintained XCUITest runner (`AgentDeviceRunner`) with a typed
Node.js client, runner build caching keyed on Xcode + package version, physical
device signing, external `.xctestrun` support, and an `alert` command that
resolves blocking SpringBoard modals. Its help text and typings were read
directly from v0.21.0 (`agent-device help workflow|physical-device|prepare|
alert|settings`, `dist/src/client-types.d.ts`, runner Swift sources); see
"Verified facts" below.

## Decision

Delete the Harness XCTest agent and implement iOS permission automation on top
of the `agent-device` Node.js API (`createAgentDeviceClient`), keeping the
user-facing `permissions: true` contract and its reactive "tap the positive
button when a prompt appears" semantics.

Concretely:

1. `@react-native-harness/platform-apple` depends on `agent-device` (pinned
   `~0.x`, loaded lazily only when `permissions` is enabled on iOS). No global
   install; the daemon is spawned from the dependency with `process.execPath`.
2. Harness runs its own agent-device daemon: `AGENT_DEVICE_STATE_DIR` =
   `~/.agent-device/harness/<projectRootHash>`. This isolates Harness from a
   developer's own daemon, which the bundled client would otherwise replace on
   version mismatch or reuse with stale signing env. Device-claim arbitration
   stays correct because claims are host-global (`~/.agent-device/
   device-claims`), independent of the state dir.
3. Session model: Harness never calls `apps.open`. After the simulator is
   booted and the app installed it calls `command.prepare({ action:
   'ios-runner', udid })` with an explicit `session` name; `alert` and `press`
   then run session-less against the same `udid` (verified: agent-device
   attaches an implicit runner session and answers `ALERT_NOT_FOUND` when no
   prompt is shown). Harness keeps launching, killing and relaunching the app
   under test through `simctl`/`devicectl` exactly as today (launch env,
   stdout capture, crash detection, `resetEnvironmentBetweenTestFiles` are
   untouched). agent-device never launches the app under test.
4. Permission watchdog moves to Node: a loop (default 1 s, env
   `HARNESS_PERMISSION_WATCHDOG_INTERVAL_MS`, old
   `HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS` accepted as alias) calls
   `command.alert({ action: 'get', timeoutMs })`; when a modal is present it
   picks the first button from the Harness positive-label list among the
   returned `items` and taps it with `interactions.press({ selector:
   'label="…"' })` (the runner routes taps to SpringBoard for blocking system
   modals; `alert accept` is not used because it rejects 3-button sheets such
   as location). The loop runs only while the app under test is running in
   the foreground: polling with the SpringBoard home screen foregrounded walks
   the whole icon grid, exceeds the runner's main-thread watchdog and triggers
   `RUNNER_BUSY` restart storms (reproduced on iOS 26.4). The loop is
   abort-signal driven and serialised (one in-flight command at a time), and
   `RUNNER_BUSY`/timeouts are logged and retried, never fatal.
5. Physical devices: `device.codeSign` maps to the daemon's env at spawn
   (`AGENT_DEVICE_IOS_TEAM_ID`, `_SIGNING_IDENTITY`, `_PROVISIONING_PROFILE`);
   a new optional `codeSign.runnerBundleId` maps to
   `AGENT_DEVICE_IOS_BUNDLE_ID`. Without `codeSign` Harness skips the runner,
   as today.
6. External/hosted runners: `HARNESS_IOS_XCTESTRUN_FILE` and
   `HARNESS_IOS_XCTEST_DERIVED_DATA_PATH` are kept and forwarded to
   `iosXctestrunFile` / `iosXctestDerivedDataPath`; the artifact must now be an
   `AgentDeviceRunner` build (`agent-device prepare ios-runner --json` prints
   `xctestrunPath`). `harness xctest build` is removed.
7. Runner build cache: Harness sets `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH` to
   `.harness/cache/agent-device-runner`; action.yml caches that directory keyed
   on `agent-device` version + `xcodebuild -version` (replacing the
   `xctest-agent-simulator-*` cache and `cache.json` hashing).
8. Teardown: `daemon stop --state-dir … --clean` (CLI bin from the
   dependency; verified to kill daemon, `xcodebuild`, `AgentDeviceRunner` and
   snapshot-bridge and release the device claim) so a Harness run leaves no
   process behind, matching current guarantees. Warm-runner reuse across runs
   is deliberately not used; a fresh daemon attaches a cached runner in ~3 s
   (~12 s on the first attach after a simulator boot), the on-disk build
   cache survives.

## Architecture impact

- Removed: `packages/platform-ios/xctest-agent/` (Xcode project),
  `xctest-agent.ts`, `xctest-agent-client.ts`, `xctest-agent-transport*.ts`,
  `xctest-agent-capabilities.ts`, `xctest-command.ts`, `startup-strategy.ts`,
  their tests, the `xctest` platform CLI command, `buildXCTestAgent` exports,
  the `xctest-agent-simulator` special case in `@react-native-harness/cache`
  and `tools` artifact naming, and the action.yml "Harness cache" steps.
- Added: `packages/platform-ios/src/permission-agent.ts` (client lifecycle,
  daemon state dir, prepare, watchdog loop, teardown) with tests mocking the
  client; a `harness ci` helper that prints the runner cache key for
  action.yml.
- `instance.ts` loses the build/boot overlap strategy; the runner is prepared
  after boot (agent-device requires a booted target) but its build is cached.
- Node floor: every Harness package declares `engines.node >= 22.12`
  (agent-device's floor). Harness declares no `engines` today; this is a
  repo-wide change made in the same release rather than a permissions-only
  runtime check.
- Harness stays the sole owner of app lifecycle; agent-device owns only the
  XCUITest runner and SpringBoard alert handling.

## Compatibility and conflicts

| Conflict | Resolution |
| --- | --- |
| Accept-label mismatch: agent-device `alert accept` knows `ok/allow/yes/continue/done/open/open settings/confirm*`; Harness also taps `While Using the App`, `Allow Once`, `Always Allow`, `Next`, `Join`, `Pair`, `Allow Full Access`. Verified: `alert accept` fails with "alert accept button not found" on the Maps location prompt. | Watchdog reads `items` from `alert get` and taps by label with `press`; verified to dismiss the location prompt. Upstreaming the labels to agent-device is optional follow-up. |
| Polling cost depends on the foreground app; SpringBoard home screen is pathological (watchdog timeouts, `RUNNER_BUSY`). | Poll only while Harness's app session reports the app running; pass `timeoutMs`; treat busy/timeout as transient. |
| One-shot vs continuous: agent-device activates once per command and only observes. | Continuous behaviour is reproduced by the Node polling loop. |
| Reaction time: each `alert get` round-trip is ~4 s, so a prompt can sit up to ~4 s before it is tapped (in-process watchdog: ~1 s). | Accepted; documented in the permissions guide. Tests already wait tens of seconds for permission results. |
| Daemon env is captured at spawn (signing vars) and shared per state dir. | Harness-owned state dir, daemon stopped at end of run. |
| Device claims: an open developer agent-device session on the same simulator yields `DEVICE_IN_USE` (reproduced locally against a live session from another workspace). | Surface the error verbatim with the recovery command; do not retry. |
| Physical device runner bundle ids change (`AgentDeviceRunner` + `.uitests`), so provisioning profiles for the old `HarnessXCTestAgent` id stop working. | Breaking change, documented; `codeSign.runnerBundleId` for personal teams. |
| Hosted device farms shipped the Harness agent `.xctestrun`. | Env var names kept; artifact must be rebuilt with `agent-device prepare ios-runner`. Breaking, documented. |
| `harness xctest build` disappears. | Removed; docs point to `agent-device prepare ios-runner`. |
| Runner cache location and key change (CI cache miss once). | New action.yml key; one cold build per Xcode/agent-device bump. |
| Logs: xcodebuild output moved from `.harness/logs/…/xcodebuild.log` to the session `runner.log` in the state dir. | Harness copies `runner.log`/`daemon.log` into `.harness/logs` on teardown so the action still uploads them. |

## Expected outcome

Merge gates for the implementation PR (all four are required):

1. The E2E iOS CI job with `permissions: true` (playground camera test) is
   green.
2. Manual verification on a signed physical iPhone with `device.codeSign`,
   recorded in the PR description.
3. A startup benchmark, old agent vs new, cold and cached, measured on CI
   and pasted into the PR (a true cold runner build could not be provoked
   locally; expected cached cost is ~3 s per run, see "Verified facts").
4. A test or CI step asserts that no `xcodebuild`, `AgentDeviceRunner` or
   agent-device daemon process survives a Harness run.

Also expected:

- Harness contains no Swift, no Xcode project, no `xcodebuild` invocation and
  no HTTP transport for permission automation.
- Ships as a minor release (version plan for `platform-apple`, `cli`, and
  every package gaining `engines`) whose changelog and the permissions guide
  call out the two breaking paths (physical device signing, external
  `.xctestrun`) and the Node floor.

## Not building

- Android changes: `adb pm grant` stays; agent-device's fixed permission list
  is a subset of what the manifest-driven grant covers.
- Proactive iOS pre-granting (Info.plist usage keys → `settings permission
  grant`); it would change semantics for tests that expect a prompt.
- Driving app UI through agent-device (`@react-native-harness/ui` stays on the
  in-app bridge), MCP, cloud/device-farm providers, recordings, snapshots.
- Per-permission or per-platform `permissions` configuration.
- Keeping a warm runner between Harness runs.

## Verified facts (agent-device 0.21.0)

- Node client: `createAgentDeviceClient(config)` with `stateDir`, `session`,
  `lockPolicy`, `iosXctestrunFile`, `iosXctestDerivedDataPath`;
  `command.alert/prepare`, `apps.open/close`, `sessions.close`,
  `settings.update`, `interactions.press`. No daemon-stop method (CLI only).
- Runner sources ship in `dist/apple/runner`; built by the daemon, cached in
  `~/.agent-device/apple-runner/derived/<sdk>/cache-<hash>` keyed on Xcode,
  SDK, package version and runner source fingerprint;
  `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH` overrides the location.
- `alert` resolves SpringBoard alerts/sheets first, then the session app's
  alerts; `accept` verifies the presentation changed and activates once.
  `snapshot`/`press` route to SpringBoard while a blocking system modal is up.
- `prepare ios-runner` needs a booted device and works without an open
  session; docs recommend exact cache keys and no broad `restore-keys`. Runner
  derived data is ~165 MB. Measured locally (iPhone 17 Pro, iOS 26.4, cached
  runner): fresh daemon + settled simulator 3.2 s (0.45 s connect, 2.65 s
  health check), first attach after boot 11.6 s, warm runner 17 ms; a true
  cold build (`buildMs > 0`) could not be provoked and remains unmeasured.
- `alert get` with no prompt showing and Settings foregrounded: 3.9 s wall
  clock per CLI call (5 samples, tight spread), so the watchdog's reaction
  time is bounded by the runner round-trip, not by the poll interval.
- `settings permission grant` only covers the simctl privacy services of the
  runtime (no `camera`, no `notifications` on iOS 26.4), which is why a
  proactive pre-grant design was rejected.
- Daemon: spawned detached with the client's `process.env`, idle-reaps after
  5 min, replaced on version/code-signature mismatch; runner kept warm 5 min
  after `close` unless stopped.
- Physical devices: signing via `AGENT_DEVICE_IOS_*` env (`DEVELOPMENT_TEAM`,
  `CODE_SIGN_STYLE` Manual/Automatic). Session-less `alert`/`press` were
  verified on a simulator only; the physical path is merge gate 2.
