---
name: mocking
description: Mocking and spying guidance. Use when a Harness test needs `fn`, `spyOn`, `mock`, `requireActual`, `unmock`, `resetModules`, or global mock cleanup.
---

# Mocking

Use this skill when a Harness test needs mock functions, spies, or module replacement.

## Mocking and spying

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

## Module mocking

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

## Decision rules

- Always clean up module mocks with `resetModules()` in `afterEach` when tests mock modules.
- Use `requireActual()` for partial mocks so unrelated exports stay real.
- For `react-native`, preserve property descriptors when partially mocking to avoid triggering lazy getters too early.
- Remember that module factories are evaluated when the module is first required.
