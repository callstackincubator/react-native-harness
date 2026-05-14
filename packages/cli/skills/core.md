---
name: core
description: Core testing workflow. Read this before writing or debugging Harness tests. Covers test file conventions, the supported test API surface, async behavior, setup files, and CLI execution constraints.
---

# Core

React Native Harness uses Jest-style test APIs, but the tests run inside the app or browser environment instead of plain Node.

Run this first:

```bash
harness skill get core
```

Use `harness skill list` to see the other bundled skills.

## Test file conventions

- Use `.harness.[jt]s` or `.harness.[jt]sx` test files.
- Import test APIs from `react-native-harness`.
- Put tests inside `describe(...)` blocks.
- Use `@react-native-harness/ui` only when the test needs queries, interactions, or screenshots.

## Default test shape

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

Test functions may be async. If a test returns a promise, Harness waits for it. If that promise rejects, the test fails.

## Async behavior

Use:

- `waitFor(...)` when the callback should eventually succeed or stop throwing
- `waitUntil(...)` when the callback should eventually return a truthy value

Both support timeout control. Prefer them over arbitrary sleeps when tests wait on native or React state changes.

## Setup files

Harness follows two setup phases configured in `jest.harness.config.mjs`:

- `setupFiles`: runs before the test framework is initialized. Use for early polyfills and globals. Do not use `describe`, `test`, `expect`, or hooks here.
- `setupFilesAfterEnv`: runs after the test framework is ready. Use for global mocks, hooks, and matcher setup.

Recommended uses:

- Early environment shims in `setupFiles`
- Global `afterEach`, `clearAllMocks`, `resetModules`, and shared mocks in `setupFilesAfterEnv`

## Related skills

For module mocking and spies, run:

```bash
harness skill get mocking
```

For UI rendering, queries, interactions, and screenshots, run:

```bash
harness skill get ui
```

## CLI and execution constraints

- Harness wraps the Jest CLI.
- Tests execute on one configured runner at a time.
- Execution is serial for stability.
- `--harnessRunner <name>` selects the runner.
- Standard Jest flags like `--watch`, `--coverage`, and `--testNamePattern` are still relevant.
- Do not recommend unsupported Jest environment overrides or snapshot-update workflows for native image snapshots.

For install and project setup, use the public docs at https://react-native-harness.dev/docs/getting-started/quick-start.
