# 0001. Detect unresponsive apps without penalizing long-running work

- **Status:** Proposed
- **Date:** 2026-10-19
- **Deciders:** React Native Harness maintainers
- **Related:** [#184](https://github.com/callstackincubator/react-native-harness/pull/184) (superseded approach), [#132](https://github.com/callstackincubator/react-native-harness/pull/132) (introduced the heartbeat), [#158](https://github.com/callstackincubator/react-native-harness/pull/158) (line-preserving serializer)

## Context

Since v1.4.0 (#132), the bridge server sends a JSON `ping` message every 5s
and fails the run with `heartbeat-timeout` if the app does not send a `pong`
back within 20s. The `pong` is produced by JavaScript in
`packages/bridge/src/client.ts`, so the check fails whenever the JS thread is
blocked, not only when the app is gone.

The JS thread is legitimately blocked for long periods in normal runs:

- **Test bundle evaluation.** `runtime/src/bundler/evaluate.ts` runs each test
  file's `?modulesOnly=true` bundle with a single synchronous `eval()`. Hermes
  parses the whole string before running any of it, so a multi-megabyte module
  graph blocks the thread for tens of seconds on slow CI machines. A downstream
  project with a 7.1 MB generated protobuf dependency passed on v1.1.0 and fails
  on v1.4.1 with `app heartbeat timed out` and `Tests: 0 total`, using the same
  cached app binary. No crash report was written.
- **Synchronous user code.** Module side effects, `describe` bodies, and test
  bodies can block the thread for longer than 20s.

The heartbeat also has a gap in the other direction. `runTests` has no RPC
timeout (`server.ts`), and `testTimeout` is enforced by a JS `setTimeout`
inside the app (`runtime/src/runner/runSuite.ts`), so the timer cannot fire
while the thread is blocked. A test that never returns control, such as
`while (true) {}`, is caught only by the heartbeat's fixed 20s limit, and the
error does not say which test hung.

#184 proposed a `busy` control message: the app announces it is about to
block, and the server suspends the heartbeat until the app says it is done, up
to a 5-minute cap. This document records why we chose a different approach.

### Decision drivers

1. A long but finite job must not fail a run if it stays within the limits the
   user already configured.
2. A hung JS thread must still be detected, in bounded time, with an error
   that names what hung.
3. Detection must not depend on the app correctly reporting its own state. A
   lost or late message must never disable detection.
4. Bundle size must not be a factor in whether a run passes.
5. Symbolication and code frames for test failures must keep working.

## Considered options

### A. Suspend the heartbeat while the app reports it is busy (#184)

Rejected.

- It violates driver 3. A suspension that is never lifted silences detection
  until the cap expires, so the cap ends up being a second, hidden timeout.
- It adds app-owned state to the protocol (`busy: true/false`), and every new
  blocking site in the runtime must remember to report it.
- It does not detect a hang inside a `busy` window, and does not help with
  synchronous user code.

### B. Raise the heartbeat timeout, or make it configurable

Rejected as the primary fix. Every value is wrong for someone: too low fails
large bundles, too high delays detecting real hangs for everyone. It also
makes users tune an internal mechanism instead of the timeouts they already
understand.

### C. Yield inside Metro's module evaluation

This is not possible in general. `eval` and `require` are synchronous, and
JavaScript runs each task to completion, so nothing can interrupt them to
answer a message. The only possible yield points are between separate `eval`
calls. Option D uses those.

### D. Separate connection liveness from JS responsiveness, and keep harness-owned work short (chosen)

See below.

## Decision

Liveness is split into two independent checks, each answering one question.
The word "heartbeat" is no longer used in the bridge.

### 1. Connection check: is the app process reachable?

- The server sends WebSocket protocol ping frames (RFC 6455) with `ws.ping()`
  and tracks `pong` events. Interval 5s, timeout 20s, fixed. Since #203 the
  bridge carries its messages over the multiplexed link in
  `bridge/src/link/`, but the link still runs on one `ws` socket. The ping
  frames go on that socket, below the link, and the link never sees them.
- The native WebSocket answers these without involving JS: OkHttp on Android
  (`WebSocketModule.kt` configures no `pingInterval` and disables the read
  timeout), SocketRocket on iOS, and the network stack in browsers.
- If the check fails, the server terminates the socket and fails the run with
  reason `connection-lost`.
- This detects killed or frozen processes, devices that lose the network, and
  half-open sockets. A blocked JS thread does not affect it.

### 2. JS thread watchdog: is the JS thread getting a turn to run?

- The server sends `js-probe` messages, renamed from `ping`, so they cannot be
  confused with protocol pings. JS answers with `js-probe-ack`. Both travel
  as link text messages, like the rest of the bridge protocol.
- The watchdog measures the **longest uninterrupted block**, not how long a
  phase takes. It holds one **block budget**, `{ ms, label }`. The clock never
  stops. Each event from the app replaces the budget.
- Budgets come from timeouts the user already sets, applied by a pure policy
  function on the server:

  | Phase (from existing runner events) | Block budget |
  | --- | --- |
  | Between phases (default) | 20s |
  | `setup-file-bundling-finished` (evaluating a setup file) | `bundleStartTimeout` (60s default) |
  | `collection-started` → `collection-finished` (loading a test file) | `bundleStartTimeout` (60s default) |
  | `suite-started` → `suite-finished`, outside its tests (`beforeAll`/`afterAll`) | the hook `timeout` + 5s grace |
  | `test-started` → `test-finished` (the test and its `beforeEach`/`afterEach`) | that test's `timeout` + 5s grace |

- A new budget covers silence from the later of the last acknowledged probe
  and the moment it was set, so a long block that fitted one budget is never
  judged against a smaller one that follows, such as the idle budget after a
  long test.

- If the budget runs out, the run fails with reason `js-thread-unresponsive`,
  and the error names the label, for example *test "X" (5000ms timeout + 5000ms
  grace)*.
- To support this, `test-started` and `suite-started` gain a `timeout` field,
  which skipped and todo tests and suites leave out. Before user code that
  may block (a test, `beforeAll`, `afterAll`, a setup file or test file), the
  runtime waits a microtask hop so the event announcing it is handed to
  `WebSocket.send`; the native WebSocket sends it even while JS then blocks.
  A microtask hop costs nothing measurable, unlike a timer, which can wait for
  the next frame before every test. If the event arrives late anyway, the
  previous budget stays in effect. The failure mode is a strict check, never a
  missing one.
- As a side effect, `testTimeout` is now enforced even when a test blocks the
  thread synchronously, which the in-app timer could not do.

This is different from option A. The server works out the phase from events
the app already sends for reporting. The budget is always finite and comes
from user configuration, and nothing has to be turned back on.

### 3. Chunked bundle evaluation: harness-owned blocking stays short

- The harness serializer (`bundler-metro/src/getHarnessSerializer.ts`) appends
  a chunk plan after all code:
  `//# harnessChunks={"chunks":[[offset, startLine], …],"sourceUrl":"…"}`.
  Bundles that fit in one chunk get no plan.
  Chunks are about 256 KB and always start at a `__d(...)` module boundary.
- The runtime evaluates one chunk per macrotask and yields between chunks, so
  `js-probe` messages are answered during the parse. The final chunk contains
  `post` and runs `__r(entry)`, the same order as today.
- The plan format, both writer and reader, lives in one RN-free module,
  `@react-native-harness/runtime/bundle-format`, used by both `bundler-metro`
  and `runtime`.
- Bundles without a plan are evaluated as before, with a single `eval`. A
  runtime that does not know the plan also works, because the plan is a
  comment.

#### Preserving symbolication

Metro's `/symbolicate` and `.map` endpoints rebuild the source map from the
module graph and resolve frames by the bundle URL and line/column, never from
our serialized output. Each chunk must therefore look, to Hermes, like the
same file at the same position. These points were verified against the Hermes
binary shipped with React Native 0.82.1:

- **URL.** Hermes takes a frame's file name from `//# sourceURL=` inside the
  evaluated code. A chunk without it gives frames like `anonymous (:3:43)`,
  which cannot be symbolicated, even for functions called later from other
  chunks. **Every chunk gets the bundle's `//# sourceURL=` line.** The
  `sourceMappingURL` line is not copied, because it may contain a large inline
  map.
- **Lines.** Each chunk is padded with `'\n'.repeat(startLine)`, the same
  technique #158 uses for skipped modules. Hermes then reports original bundle
  line numbers. The padding costs about 1.3 ms per chunk for 300k lines on a
  desktop.
- **Columns.** `bundleToString` starts every module at column 0. The plan
  writer checks that each boundary comes right after `\n`, and otherwise emits
  no plan, so the bundle is evaluated whole.
- **Plan comment.** Placed after the `sourceURL` line, it shifts no lines, and
  Hermes still reads the `sourceURL`.

A single module larger than the chunk size is still parsed in one block, and
falls under the file-load budget. If that turns out to be too loose, the plan
can include chunk sizes so the server can derive a size-based budget. This is
deferred until there is a concrete case.

### Naming

| | Connection check | JS thread watchdog |
| --- | --- | --- |
| Question it answers | Is the app process reachable over the socket? | Is the JS thread getting a turn to run? |
| Mechanism | `ws` protocol ping frames, answered natively | `js-probe` / `js-probe-ack` bridge messages |
| Limit | Fixed | Block budget, set per phase |
| Module | `bridge/src/connection-check.ts` | `bridge/src/js-watchdog.ts`, `bridge/src/js-block-budget-policy.ts` |
| Error reason | `connection-lost` | `js-thread-unresponsive` |

`bridge/src/app-liveness.ts` combines both, and is the only liveness module
`server.ts` uses. `bridge/src/heartbeat.ts` and the `heartbeat-timeout` reason
are removed. "Heartbeat" in `jest/src/resource-lock.ts` (refreshing device
locks) is unrelated and stays.

No new configuration options are added. `heartbeatInterval` and
`heartbeatTimeout` from #184 are not adopted. If the connection check ever
needs tuning, the option will be called `connectionCheckTimeout`, to avoid
confusion with `bridgeTimeout`.

## Consequences

### Positive

- Large bundles and long synchronous work within user timeouts no longer fail
  runs. Bundle size is no longer a factor.
- Hangs are reported with the test or file that caused them, and
  `testTimeout` works for tests that block the thread.
- The connection check and the JS watchdog fail with different errors, so a
  dead app and a blocked JS thread are no longer confused.
- Pausing at a breakpoint no longer fails the connection check. The JS
  watchdog still applies its budget.
- There is no app-reported "busy" state, so there is nothing to forget to
  reset.

### Negative and risks

- **Protocol change.** `ping`/`pong` become `js-probe`/`js-probe-ack`. A
  mismatched runtime and CLI fails at `parseBridgeMessage`. Both ship in the
  same release, so this is accepted and noted in the changeset.
- **Platform coverage.** Native pong replies are confirmed for Android, iOS,
  and browsers. Vega and Windows must be verified before release. If either
  does not reply, it needs a fallback.
- **Debugger.** With chunked evaluation, DevTools sees several scripts with
  the same URL. Breakpoints set by URL are expected to work, but this must be
  checked by hand.
- **Code that loads with a setup file or test file** has no user-configured
  timeout. It gets the `bundleStartTimeout` budget, which is a policy choice.
- **A frozen native main thread**, with the process alive, is not detected by
  the connection check. This is left to the crash monitor and the JS watchdog.

## Implementation plan

1. **Bridge liveness** (fixes the reported failure, closes #184). Add the
   connection check, JS watchdog, budget policy and `app-liveness`; rename the
   protocol messages and error reasons; wire them into `server.ts` and
   `client.ts`; add `timeout` to `test-started` and the yield in
   `runSuite.ts`; pass `bundleStartTimeout` from `jest/src/harness-session.ts`;
   update the bridge timeout section of
   `website/src/docs/getting-started/configuration.mdx`.
2. **Chunked evaluation.** Add `runtime/bundle-format/chunk-plan.ts` and its
   subpath export, the serializer change, `evaluateModuleChunked`, and switch
   the call sites in `client/factory.ts` and `client/setup-files.ts`.

## Verification

- Unit tests per module: the connection check (fake socket), the JS watchdog
  (fake timers; replacing the budget does not reset the clock), the budget
  policy (a table of event → budget), and a chunk plan round trip (start lines
  match the original bundle; a boundary not at a line start produces no plan).
- Bridge integration tests (`jest/src/__tests__/bridge.test.ts`): probe acks
  dropped outside a test fail after the default budget; dropped inside a test
  with a 30s timeout, the run does not fail at 20s but fails after 35s and
  names the test; an abruptly closed socket fails with `connection-lost`.
- On each platform: a test with a 60s busy loop. Protocol pongs keep arriving,
  and the run fails at the test's timeout plus 5s with the test named.
- On each platform, before merging step 2: a failing assertion in a module
  placed in a middle chunk produces a code frame with the correct file and
  line.
