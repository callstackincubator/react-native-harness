---
name: react-native-harness
description: Write and debug React Native Harness tests for app code. Use when the user asks to create or fix tests that import from react-native-harness, mock modules, spy on functions, render React Native components on-device, use setupFiles or setupFilesAfterEnv, or add optional UI tests with @react-native-harness/ui.
---

# React Native Harness

React Native Harness tests use Jest-style APIs but run in the app or browser environment instead of plain Node.

## Test File Conventions

- Use `.harness.[jt]s` or `.harness.[jt]sx` test files.
- Import test APIs from `react-native-harness`.
- Put tests inside `describe(...)` blocks.
- Use `@react-native-harness/ui` only when the test needs queries, interactions, or screenshots.

## Default Test Shape

```ts
import { describe, test, expect } from 'react-native-harness';

describe('Feature name', () => {
  test('does something', () => {
    expect(true).toBe(true);
  });
});
```

Prefer these public APIs when writing tests:

- Test structure: `describe`, `test`, `it`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`
- Focus and pending helpers: `test.skip`, `test.only`, `test.todo`, `describe.skip`, `describe.only`
- Assertions: `expect`
- Mocking and spying: `fn`, `spyOn`, `clearAllMocks`, `resetAllMocks`, `restoreAllMocks`
- Module mocking: `mock`, `requireActual`, `unmock`, `resetModules`
- Async polling: `waitFor`, `waitUntil`

Test functions may be async. If a test returns a promise, Harness waits for it; if that promise rejects, the test fails.

## Mocking And Spying

Use `fn()` for standalone mock functions and `spyOn()` for existing methods.

- `expect` follows Vitest's API.
- `expect.soft(...)` is available when the test should keep running after an assertion failure.
- `clearAllMocks()` clears call history but keeps implementations.
- `resetAllMocks()` clears call history and resets mock implementations.
- `restoreAllMocks()` restores spied methods to their original implementations.

Typical cleanup:

```ts
import { afterEach, clearAllMocks } from 'react-native-harness';

afterEach(() => {
  clearAllMocks();
});
```

## Module Mocking

Use module mocking when the test must replace an entire module or specific exports.

- `mock(moduleId, factory)` registers a lazy mock factory.
- `requireActual(moduleId)` is the safe path for partial mocks.
- `unmock(moduleId)` removes a mock for one module.
- `resetModules()` clears module mocks and module cache state.

Recommended pattern:

```ts
import {
  afterEach,
  describe,
  expect,
  mock,
  requireActual,
  resetModules,
  test,
} from 'react-native-harness';

afterEach(() => {
  resetModules();
});

describe('partial mock', () => {
  test('overrides one export but keeps the rest', () => {
    mock('react-native', () => {
      const actual = requireActual('react-native');
      const proto = Object.getPrototypeOf(actual);
      const descriptors = Object.getOwnPropertyDescriptors(actual);
      const mocked = Object.create(proto, descriptors);

      Object.defineProperty(mocked, 'Platform', {
        get() {
          return {
            ...actual.Platform,
            OS: 'mockOS',
          };
        },
      });

      return mocked;
    });

    const rn = require('react-native');
    expect(rn.Platform.OS).toBe('mockOS');
  });
});
```

- Always clean up module mocks with `resetModules()` in `afterEach` when tests mock modules.
- Use `requireActual()` for partial mocks so unrelated exports stay real.
- For `react-native`, preserve property descriptors when partially mocking to avoid triggering lazy getters too early.
- Remember that module factories are evaluated when the module is first required.

## Async Behavior

Use:

- `waitFor(...)` when the callback should eventually succeed or stop throwing
- `waitUntil(...)` when the callback should eventually return a truthy value

Both support timeout control. Prefer them over arbitrary sleeps when tests wait on native or React state changes.

## UI Testing

UI testing is opt-in and uses `render(...)` from `react-native-harness` together with `@react-native-harness/ui`.

Use `render(...)` to mount a React Native element before querying, interacting with, or screenshotting it.

- `render(...)` is async
- `rerender(...)` is async
- `unmount()` is optional because cleanup happens automatically after each test
- `wrapper` is the right tool for providers and shared context
- Rendered UI appears as an overlay in the real environment, not as an in-memory tree
- Only one rendered component can be visible at a time

Use it when the task requires:

- `render(...)` or `rerender(...)`
- `screen.findByTestId(...)`
- `screen.findAllByTestId(...)`
- `screen.queryByTestId(...)`
- `screen.queryAllByTestId(...)`
- `screen.findByAccessibilityLabel(...)`
- `screen.findAllByAccessibilityLabel(...)`
- `screen.queryByAccessibilityLabel(...)`
- `screen.queryAllByAccessibilityLabel(...)`
- `userEvent.press(...)`
- `userEvent.type(...)`
- screenshots with `screen.screenshot()`
- element screenshots with `screen.screenshot(element)`
- image assertions with `toMatchImageSnapshot(...)`

- Keep imports split correctly: core APIs from `react-native-harness`, UI APIs from `@react-native-harness/ui`.
- Mention that `@react-native-harness/ui` requires installation, and native apps must be rebuilt after adding it.
- `toMatchImageSnapshot(...)` needs a unique snapshot `name`.
- If screenshotting elements that extend beyond screen bounds, call out `disableViewFlattening: true` in `rn-harness.config.mjs`.
- On web, UI interactions and screenshots run through the web runner's Playwright-backed browser environment.

## Setup Files

Harness follows two setup phases configured in `jest.harness.config.mjs`:

- `setupFiles`: runs before the test framework is initialized. Use for early polyfills and globals. Do not use `describe`, `test`, `expect`, or hooks here.
- `setupFilesAfterEnv`: runs after the test framework is ready. Use for global mocks, hooks, and matcher setup.

Recommended uses:

- Early environment shims in `setupFiles`
- Global `afterEach`, `clearAllMocks`, `resetModules`, and shared mocks in `setupFilesAfterEnv`

## CLI And Execution Constraints

- Harness wraps the Jest CLI.
- Tests execute on one configured runner at a time.
- Execution is serial for stability.
- `--harnessRunner <name>` selects the runner.
- Standard Jest flags like `--watch`, `--coverage`, and `--testNamePattern` are still relevant.
- Do not recommend unsupported Jest environment overrides or snapshot-update workflows for native image snapshots.

For install, runner setup, and config files, read [references/installation.md](references/installation.md).
