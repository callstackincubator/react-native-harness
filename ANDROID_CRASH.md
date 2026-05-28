# Android Crash Detection Plan

## Goal

Implement Android `AppSession` crash detection using `adb` polling for liveness and `logcat` streaming for evidence, while preserving the same harness-level behavior introduced by the iOS crash-detection refactor.

The Android implementation should:

- treat bridge disconnect as the earliest crash signal
- classify bridge disconnect plus exited app state as `NativeCrashError`
- classify bridge disconnect plus still-running app state as `RuntimeDisconnectError`
- attach Android log evidence when it is available
- tolerate the fact that Android app launch is not a blocking, console-attached process

## Decisions

- Android should keep the shared `AppSession` contract introduced by `CRASH_PLAN.md`.
- Android app liveness should be driven by polling, not by a blocking launch handle.
- Android crash evidence should come from a session-owned bounded `logcat` buffer.
- Android should use a device-side pre-launch timestamp to reduce the race where the app crashes before the host-side `logcat` reader is attached.
- Android should start session log capture with `--uid=<appUid>` because PID is not known at launch time.
- We can assume there is only one process for the target app, so `--uid=<appUid>` is sufficiently app-scoped for bootstrap capture.
- `pidof` should still be used for liveness, cached state, and optional PID attachment to session state.
- Switching the log stream from `--uid` to `--pid` after PID discovery is optional, not required for v1.
- `createAppSession()` should resolve only after log capture and exit observation are attached, the app launch command has completed, and early launch failure has already surfaced.
- `dispose()` should remain the intentional kill path and must suppress late exit or log signals.
- Android should prefer `logcat` session evidence over separate crash artifact collection in v1 of this plan.

## Why Android Differs From iOS

- iOS can treat the launch-attached process stream as both launch control and session log source.
- Android `adb shell am start ...` is only a start command. It does not remain attached to the app process.
- Android therefore needs two separate observation channels:
  - polling for app liveness
  - `logcat` streaming for crash evidence

## Startup Race Mitigation

The main Android-specific risk is that the app can crash before the host starts consuming `logcat` output.

To reduce that race:

1. Read a device-side timestamp before launch.
2. Start `logcat` with `-T <timestamp>` so Android replays buffered lines from that time onward.
3. Scope the bootstrap stream with `--uid=<appUid>`.
4. Launch the app.
5. Poll `pidof` until the process appears or early launch failure is detected.

This does not make the race mathematically impossible, because log buffers can still rotate, but it should recover immediate startup crash lines in the normal case.

Suggested bootstrap shape:

```ts
const sessionStartTimestamp = await adb.getLogcatTimestamp(adbId);

const logcatProcess = adb.startLogcat(adbId, [
  'logcat',
  '-v',
  'threadtime',
  '-b',
  'crash',
  `--uid=${appUid}`,
  '-T',
  sessionStartTimestamp,
]);

await adb.startApp(adbId, bundleId, activityName, launchOptions);
```

If the app dies before PID is ever observed, the crash monitor should still be able to classify it as a native crash from:

- session state becoming `exited`
- buffered `logcat` evidence captured via `-T <timestamp>`

As a fallback, Android may also do one final dump query using the same lower bound before final classification if the streaming path produced no lines.

## AppSession Responsibilities

Android `AppSession` should own:

- launch command execution via `adb startApp(...)`
- a bounded session log buffer populated from `logcat`
- cached app-session state
- exit notification
- disposal

Suggested Android shape remains the shared shape:

```ts
type AppSession = {
  dispose: () => Promise<void>;
  getState: () => Promise<AppSessionState>;
  getLogs: () => AppSessionLog[];
  addListener: (listener: AppSessionListener) => void;
  removeListener: (listener: AppSessionListener) => void;
};
```

Suggested Android state behavior:

- initial state should become `{ status: 'running', pid?: number }` once launch observation is attached and the app is considered started
- when polling observes the process is gone, state should become `status: 'exited'`
- `pid` should be attached when discovered and preserved on exit when available
- `getState()` should return cached state only and must not call `adb`

## Android Observation Flow

Minimal session flow:

1. Stop any old app process before launch.
2. Read device timestamp via `adb.getLogcatTimestamp(adbId)`.
3. Start session-owned `logcat` with `-T <timestamp>` and `--uid=<appUid>`.
4. Start the app with `adb.startApp(...)`.
5. Poll `pidof` until the process appears, or until it is clear launch already failed.
6. Start the steady-state liveness poll.
7. Push all `logcat` lines into the bounded session log buffer.
8. When polling observes the process is gone, update cached state and emit `app_exited`.

Suggested polling responsibilities:

- one early-launch poll window to confirm the app actually appeared
- one steady-state poll loop to detect process death after startup
- polling remains the source of truth for `running` vs `exited`

## Log Scoping Strategy

For this repo we can assume one process per app.

That means:

- `--uid=<appUid>` is enough to scope bootstrap logs to this app session in practice
- PID filtering is a refinement, not a requirement

Recommended v1 strategy:

- start with one session-long `logcat` stream using `--uid=<appUid>`
- store all streamed lines in the bounded session buffer
- optionally parse PID-bearing lines and update cached PID when they appear

Optional later refinement:

- after PID is known, restart `logcat` with `--pid=<pid> -T <sessionStartTimestamp>` if we want tighter filtering

That refinement is optional because it increases session complexity and is not necessary under the single-process assumption.

## Evidence Strategy

Android crash evidence should come from the `AppSession` log buffer.

The implementation can reuse the same style of heuristics already present in the old Android monitor:

- fatal exception markers
- `Process: <bundleId>, PID: <pid>` lines
- native crash markers such as `>>> <bundleId> <<<`
- `Process <bundleId> (pid <pid>) has died`
- signal markers such as `SIGSEGV` or `signal 11`

Crash monitor integration should stay the same as on iOS:

1. bridge disconnect starts crash resolution
2. settle briefly
3. read cached session state
4. if state is `exited`, emit `NativeCrashError`
5. if state is still `running`, emit `RuntimeDisconnectError`
6. attach matching log lines from `appSession.getLogs()` when available

If the app is dead and logs are empty or weak, the result should still be `NativeCrashError` with a weaker summary.

## Early Launch Failure Rules

`createAppSession()` should not resolve if the launch clearly failed before the app became observable.

Android should treat these as early launch failures:

- `adb.startApp(...)` fails
- the app never appears in the early PID poll window
- the app appears and then immediately disappears before session startup settles

The exact settle duration can be tuned later, similar to iOS `LAUNCH_FAILURE_SETTLE_MS`.

## Restart And Teardown Rules

- restart should dispose the current Android session and create a fresh one
- disposal must stop the app, stop the `logcat` reader, stop polling, and suppress late signals
- intentional restart and teardown must not surface native crash or runtime-disconnect failures

## Deliverable Stages

### Stage 1: Android Session Factory

Deliverable:

- Replace the current Android no-op evidence session with a real Android session factory.
- Move Android launch, session-owned log capture, PID discovery, cached state, exit polling, and disposal into that session object.
- Keep the shared `AppSession` public contract unchanged.

Acceptance:

- Android still compiles against the same shared session types.
- `createAppSession()` returns a session with real logs and cached exit state.
- `dispose()` still force-stops the app.

### Stage 2: Startup Race Handling

Deliverable:

- Capture a device-side timestamp before launch.
- Start `logcat` with `-T <timestamp>` and `--uid=<appUid>` before `adb.startApp(...)`.
- Add an early-launch PID observation window before resolving the session.

Acceptance:

- Immediate startup crashes can still produce session log evidence in the common case.
- `createAppSession()` rejects when launch clearly fails before startup is established.

### Stage 3: Crash Evidence Integration

Deliverable:

- Teach Android crash classification to read `appSession.getLogs()`.
- Reuse or adapt the old Android crash-line heuristics for session-buffer parsing.
- Attach matching raw lines to `NativeCrashError` when available.

Acceptance:

- Android bridge disconnect plus exited state reports `NativeCrashError`.
- Android bridge disconnect plus live app reports `RuntimeDisconnectError`.
- Android crash errors include matching `logcat` lines when they exist.

### Stage 4: Optional PID Refinement

Deliverable:

- Decide whether restarting `logcat` with `--pid=<pid>` after PID discovery is worth the extra complexity.
- If implemented, preserve the same session start lower bound and avoid losing early buffered lines.

Acceptance:

- The decision is explicit.
- If omitted, `--uid` remains the supported strategy.
- If implemented, PID-specific log capture does not regress startup crash visibility.

### Stage 5: Tests And Race Coverage

Deliverable:

- Add unit tests for Android session startup, PID discovery, exit polling, log buffering, and disposal suppression.
- Add focused race tests for:
  - crash before PID discovery
  - PID discovered then process exits
  - bridge disconnect before poll notices exit
  - intentional restart and teardown suppression

Acceptance:

- Android startup race mitigation is covered.
- Session state and log buffering remain stable across restart and teardown.
- Crash classification matches the shared harness behavior.

## Known Risks

- `logcat` buffers can rotate before evidence is read in extreme cases.
- `--uid=<appUid>` is assumed to be app-scoped enough under the single-process assumption.
- Polling-based exit detection can lag real process death by up to the poll interval.
- Reattaching `logcat` on PID discovery could introduce avoidable complexity and regressions.
- Different Android versions may vary in `logcat` option support or output details.

## Open Tuning Items

- Exact early-launch PID settle timeout.
- Exact steady-state poll interval.
- Whether to read only `-b crash` or include additional buffers.
- Whether to keep `--uid` for the whole session or switch to `--pid` after PID discovery.
- Whether to perform a final `logcat -d -T <sessionStartTimestamp>` fallback read before classifying an evidence-light crash.
