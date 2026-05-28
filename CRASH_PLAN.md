# Crash Detection Refactor Plan

## Goal

Refactor app lifecycle and crash detection so Harness can treat bridge disconnects as the earliest crash signal, confirm whether the app really died, and surface either a confirmed native crash or a separate runtime-disconnect failure with the best available evidence.

## Decisions

- Bridge disconnect should start an internal crash-investigation workflow.
- If bridge disconnect is followed by `getState().status === 'exited'`, it should be treated as a crash even if no explicit crash log lines are found.
- `AppSession` should store a bounded log buffer for the whole run, and that buffer is assumed to include crash output too.
- The investigation should read the session log buffer and attach matching crash indicators when they exist.
- The final classification wait should be controlled by a constant so it can be tuned later.
- Intentional restart and teardown must not report crashes.
- `dispose()` should remain a killing action.
- `createAppSession()` should resolve only after launch log capture and exit observation are attached and early launch failures have already surfaced.
- If `createAppSession()` resolves successfully, the app should already be considered started; no separate `app_started` event is needed.
- New TypeScript shapes should use `type` aliases instead of interfaces.
- New object implementations should use factory functions instead of classes, except for errors.
- Error implementations should remain classes.
- Android should satisfy the new contracts with a no-op evidence implementation for now; full Android crash evidence is intentionally deferred.
- iOS v1 crash evidence should come only from session logs, not `.ips` or `.crash` artifact collection.

## Architecture Direction

- Replace the current `startApp` / `restartApp` / `stopApp` runner contract with `createAppSession(options?)`.
- One launch creates one `AppSession`.
- `AppSession` is terminal. When it dies, restarting means creating a new session.
- `AppSession` should absorb the current app-launch and app-monitor responsibilities.
- `crash-monitor.ts` should remain the orchestrator that combines app-session exit signals with bridge disconnect signals.
- Bridge concerns should stay out of the platform session implementation.
- Session logs should come directly from the launch stream for that app (`simctl launch ...` / `devicectl ... launch ...`), so they are already scoped to the launched app.

## AppSession Contract

`AppSession` should own:

- the launched app process or console-attached launch handle
- a bounded log ring buffer for the whole run
- app exit notification
- disposal

Proposed shape:

```ts
type AppSessionLog = {
  line: string;
  occurredAt: number;
};

type AppSession = {
  dispose: () => Promise<void>;
  getState: () => Promise<AppSessionState>;
  getLogs: () => AppSessionLog[];
  addListener: (listener: AppSessionListener) => void;
  removeListener: (listener: AppSessionListener) => void;
};
```

Rules:

- `dispose()` kills the app.
- After `dispose()`, the session must ignore its own late exit or disconnect signals.
- A session should expose events only after launch log capture and exit observation are ready.
- The session log buffer is the authoritative near-real-time evidence channel for crash text.
- `getLogs()` returns only logs produced by that launched app session.
- `getState()` returns the cached app-session state only. It must not perform platform liveness checks.
- Session-owned exit observation is responsible for updating cached state; when the session observes that the process is gone, the cached state should become `status: 'exited'`.

Suggested state shape:

```ts
type AppSessionState =
  | {
      status: 'running';
      pid?: number;
    }
  | {
      status: 'exited';
      occurredAt: number;
      pid?: number;
      reason?: 'observed-exit' | 'process-gone';
    }
  | {
      status: 'disposed';
      occurredAt: number;
    };
```

`HarnessPlatformRunner` should move from app commands to session creation:

```ts
type HarnessPlatformRunner = {
  createAppSession: (options?: AppLaunchOptions) => Promise<AppSession>;
  dispose: () => Promise<void>;
  collectNativeCoverage?: (
    options: CollectNativeCoverageOptions,
  ) => Promise<string | null>;
};
```

The existing `startApp()`, `restartApp()`, `stopApp()`, `isAppRunning()`, and
`createAppMonitor()` runner methods should be removed once all callers are
switched to `AppSession`.

Session events should stay minimal:

```ts
type AppSessionEvent = { type: 'app_exited' };

type AppSessionListener = (event: AppSessionEvent) => void;
```

## Crash Investigation Workflow

Minimal flow:

1. Bridge disconnect starts crash resolution.
2. Crash monitor waits a short configurable settle window.
3. Crash monitor checks the cached state via `appSession.getState()`.
4. If the app is dead, emit `NativeCrashError` and attach matching crash-indicator log lines if available.
5. If the app is still alive, emit runtime-disconnect error.

`getState()` replaces `isAppRunning()` on `AppSession`, but it is not an active
polling API. It should return `status: 'exited'` when the session has observed an
exit event or otherwise observed that the launched process is gone.

Suggested internal shape:

```ts
type PendingCrash = {
  testFilePath: string;
  phase: NativeCrashPhase;
  occurredAt: number;
};
```

## Error Model

- Keep `NativeCrashError` as the user-facing error for confirmed native crashes.
- Add one sibling error for bridge or runtime disconnect without confirmed native crash.
- Do not mutate error instances while the investigation is running.
- Crash resolution should keep only the minimal pending context and emit one final error when classification settles.
- `execute-run.ts` should classify both confirmed crashes and runtime-disconnect failures as runtime failures.
- If the app is dead but no explicit crash text is found, the result is still `NativeCrashError` with weaker evidence.

Suggested user-facing types and error classes:

```ts
type NativeCrashDetails = {
  phase: NativeCrashPhase;
  summary: string;
  rawLines?: string[];
};

type RuntimeDisconnectDetails = {
  phase: NativeCrashPhase;
  summary: string;
  rawLines?: string[];
};

type HarnessRuntimeFailure = NativeCrashError | RuntimeDisconnectError;

class NativeCrashError extends Error {
  constructor(
    public readonly testFilePath: string,
    public readonly details: NativeCrashDetails,
  ) {
    super(buildNativeCrashMessage(details));
    this.name = 'NativeCrashError';
    this.stack = `${this.name}: ${this.message.split('\n')[0]}`;
  }
}

class RuntimeDisconnectError extends Error {
  constructor(
    public readonly testFilePath: string,
    public readonly details: RuntimeDisconnectDetails,
  ) {
    super(buildRuntimeDisconnectMessage(details));
    this.name = 'RuntimeDisconnectError';
    this.stack = `${this.name}: ${this.message.split('\n')[0]}`;
  }
}
```

`NativeCrashError` should continue to represent confirmed app death. The new
runtime-disconnect error should represent bridge loss while the app still looks
alive. It is not a crash evidence strength signal; if the app is dead, the
result is `NativeCrashError` even when no crash log lines were found.

## Restart And Teardown Rules

- `harness-session.ts` should own the current `AppSession`.
- Restart should be implemented by disposing the current session and creating a new one.
- Crash investigation must be suppressed during intentional restart and teardown.
- Session disposal should mark an explicit intentional-shutdown state before killing the app.
- Any exit, bridge disconnect, or late log signal from an intentionally closed session must be ignored.

Suggested harness-side ownership model:

```ts
type HarnessSessionState = {
  appSession: AppSession | null;
  suppressCrashDetection: boolean;
};
```

## Platform Notes

- Both simulator and physical-device sessions are assumed to provide bounded run logs that already include crash output.
- This plan does not require a separate unified-log listener for crash detection.
- The intended implementation is to capture logs from the launch-attached stream for the app session.
- v1 should not collect or attach iOS `.ips` / `.crash` artifacts. That can be added back as a later enrichment stage if session logs are not enough.
- Matching crash-indicator lines can be detected using the same kind of regex-based heuristics the codebase already uses today.
- iOS should be the first real implementation target for session-scoped logs, exit observation, and crash evidence.
- Android should be adapted to compile against `createAppSession()` but should not attempt real crash detection yet.
- The Android no-op evidence session should preserve launch, state, and disposal behavior while returning an empty log buffer and emitting no crash-evidence events.
- On Android, bridge disconnect plus `getState().status === 'exited'` should still classify as `NativeCrashError`; only Android log/artifact evidence is deferred.

## Deliverable Stages

### Stage 1: Shared Session Contract

Deliverable:

- Add shared `AppSessionLog`, `AppSessionEvent`, `AppSessionListener`, and `AppSession` type aliases.
- Replace the runner contract with `createAppSession(options?)`, `dispose()`, and optional `collectNativeCoverage()`.
- Remove `AppMonitor` from the desired public platform contract, but keep any transitional local adapters private if they reduce risk during the migration.
- Add factory helpers for no-op sessions and bounded log buffers if they are useful across platforms.

Acceptance:

- `packages/platforms` exports the new session types.
- No new interfaces or classes are introduced.
- Existing platform packages can be migrated one at a time without widening the final public contract.

### Stage 2: iOS Session Factories

Deliverable:

- Add iOS simulator and physical-device session factories.
- Move app launch, launch-attached log capture, bounded log storage, exit observation, `getState()`, and `dispose()` into those session objects.
- Make `createAppSession()` resolve only after launch log capture and exit observation are ready.
- Keep `dispose()` as the intentional app-kill path and ignore late signals from disposed sessions.

Acceptance:

- iOS runners no longer expose `startApp()`, `restartApp()`, `stopApp()`, `isAppRunning()`, or `createAppMonitor()` through the shared contract.
- Session logs are scoped to the launched app session.
- Early launch failures surface before `createAppSession()` resolves.
- iOS v1 does not collect or attach `.ips` / `.crash` artifacts.

### Stage 3: Android No-Op Session Compatibility

Deliverable:

- Update Android runners to expose `createAppSession()` with a no-op evidence implementation.
- Preserve current Android launch, state checks, stop-on-dispose, runtime configuration, permission grant, and emulator cleanup behavior.
- Return an empty log buffer from `getLogs()`.
- Do not wire logcat crash parsing, crash artifact collection, or Android crash indicators into the new session flow yet.

Acceptance:

- Android compiles and can still launch/restart via the harness-level session lifecycle.
- Android crash investigation produces no platform-provided evidence for now, but bridge disconnect plus exited state still reports `NativeCrashError`.
- Deferred Android work is isolated behind the same `AppSession` contract.

### Stage 4: Harness Session Ownership

Deliverable:

- Update `harness-session.ts` to own the current `AppSession`.
- Replace `restartApp()` usage with `currentSession.dispose()` followed by `runner.createAppSession()`.
- Replace `stopApp()` usage with session disposal.
- Suppress crash investigation during intentional restart, native coverage shutdown, and teardown.

Acceptance:

- Restart creates a fresh terminal session.
- Late exit, disconnect, or log signals from intentionally disposed sessions are ignored.
- Native iOS coverage still gets the app shutdown it needs before collection.

### Stage 5: Crash Monitor Classification

Deliverable:

- Add `RuntimeDisconnectError` while keeping error implementations class-based.
- Refactor `crash-monitor.ts` into a factory-created object that consumes the current `AppSession`.
- Start crash investigation on bridge disconnect.
- Wait for the configurable settle window, then classify the disconnect using cached `session.getState()`.
- Emit one final failure: `NativeCrashError` for confirmed app death, `RuntimeDisconnectError` when the app still appears alive.

Acceptance:

- Bridge disconnect is the earliest crash signal.
- App death without explicit crash text still becomes a `NativeCrashError`.
- Runtime disconnects no longer masquerade as native crashes.
- The monitor does not mutate error instances while investigation is pending.
- Error call sites can continue to use `instanceof`.

### Stage 6: Session Log Evidence

Deliverable:

- Teach crash resolution to read `appSession.getLogs()`.
- Extract crash-indicator lines near the disconnect or exit time using the existing regex-style heuristics.
- Attach matching raw lines to native crash details when present.
- Keep the fallback summary explicit when app death is confirmed without strong textual evidence.

Acceptance:

- iOS crash errors include matching log evidence when the session buffer contains it.
- Missing log evidence weakens the summary but does not prevent native crash classification.
- Android contributes no log evidence in this stage.

### Stage 7: Execute-Run Runtime Failure Integration

Deliverable:

- Update `execute-run.ts` to treat both confirmed native crashes and runtime disconnects as runtime failures.
- Reset crash state after either runtime failure kind when needed.

Acceptance:

- Both failure kinds produce user-facing messages with empty Jest failure stacks.
- Existing native crash behavior is preserved for confirmed app death.

### Stage 8: Tests And Regression Coverage

Deliverable:

- Add or update unit tests for shared session contract behavior, iOS session disposal suppression, Android no-op evidence sessions, harness restart ownership, bridge-disconnect classification, runtime-disconnect errors, and log attachment.
- Add focused race-condition tests for disconnect followed by exit, exit followed by disconnect, and intentional restart or teardown.

Acceptance:

- Intentional restart and teardown do not report crashes.
- Bridge disconnect plus dead app reports `NativeCrashError`.
- Bridge disconnect plus live app reports `RuntimeDisconnectError`.
- Native crash details include session log lines when available.
- Android no-op evidence behavior is covered so future Android work can replace it safely.

## Known Risks

- False positives during intentional restart or teardown if suppression is incomplete.
- Race conditions between bridge disconnect, app exit detection, and buffered log parsing.
- Wrong log attachment if session logs contain noise that is not actually scoped to the launched app.
- Different signal quality between simulator and physical-device console output.
- Long classification waits could make failures feel hung if the timeout constant is too large.

## Open Tuning Items

- Exact duration of the buffered recent-log window.
- Exact value of the crash-classification settle timeout.
- Exact name of the non-crash disconnect error type.
