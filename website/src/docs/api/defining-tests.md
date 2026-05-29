# Defining Tests

This guide covers how to define and organize tests in Harness using test functions, test suites, and lifecycle hooks.

The following types are used in the type signatures below:

```typescript
type HarnessTaskContext = {
  name: string
  type: 'test'
  mode: 'run' | 'skip' | 'todo'
  file: {
    name: string
  }
  suite: {
    name: string
  }
}

type HarnessTestContext = {
  task: HarnessTaskContext
  onTestFailed: (fn: () => void | Promise<void>) => void
  onTestFinished: (fn: () => void | Promise<void>) => void
  skip: {
    (note?: string): never
    (condition: boolean, note?: string): void
  }
}

type TestFn = (context: HarnessTestContext) => void | Promise<void>
```

When a test function returns a promise, the runner will wait until it is resolved to collect async expectations. If the promise is rejected, the test will fail.

## Platform-Specific Test Files

Harness test files normally run on every selected runner. If a file should only run on one platform, add the runner platform ID before `.harness`:

```text
src/__tests__/only-ios.ios.harness.ts
src/__tests__/only-android.android.harness.ts
src/__tests__/browser.web.harness.ts
```

When you run Harness with `--harnessRunner ios`, files such as `*.android.harness.ts` and `*.web.harness.ts` are filtered out before Jest schedules them. Shared files such as `smoke.harness.ts` still run on every platform.

The platform segment is recognized only when it matches a `platformId` from one of your configured runners. Unknown segments are treated as part of the regular file name, so `custom.foo.harness.ts` still behaves like a shared Harness test unless `foo` is a configured platform ID.

## Test Functions

### test

- **Alias:** `it`

`test` defines a set of related expectations. It receives the test name and a function that holds the expectations to test.

```typescript
import { test, expect } from 'react-native-harness'

test('should work as expected', () => {
  expect(Math.sqrt(4)).toBe(2)
})
```

Test callbacks always receive a `HarnessTestContext` object at runtime. You can ignore the parameter when you do not need it.

```typescript
import { test, expect } from 'react-native-harness'

test('can inspect task metadata', (context) => {
  expect(context.task.type).toBe('test')
  expect(context.task.name).toBe('can inspect task metadata')
})
```

The context also lets you dynamically skip a test and register lifecycle callbacks that run after the test finishes or fails.

```typescript
import { test } from 'react-native-harness'

test('can skip dynamically', (context) => {
  context.skip('Blocked by a missing backend fixture')
})

test('can react to the final test outcome', (context) => {
  context.onTestFinished(() => {
    cleanupTemporaryFiles()
  })

  context.onTestFailed(() => {
    captureDebugLogs()
  })
})
```

### test.skip

- **Alias:** `it.skip`

If you want to skip running certain tests, but you don't want to delete the code due to any reason, you can use `test.skip` to avoid running them.

```typescript
import { test } from 'react-native-harness'

test.skip('skipped test', () => {
  // Test skipped, no error
  expect(Math.sqrt(4)).toBe(3)
})
```

### test.only

- **Alias:** `it.only`

Use `test.only` to only run certain tests in a given suite. This is useful when debugging.

```typescript
import { test } from 'react-native-harness'

test.only('test', () => {
  // Only this test (and others marked with only) are run
  expect(Math.sqrt(4)).toBe(2)
})
```

### test.todo

- **Alias:** `it.todo`

Use `test.todo` to stub tests to be implemented later. These tests will be reported as pending in the test results.

```typescript
import { test } from 'react-native-harness'

test.todo('implement this test later')
```

## Test Suites

### describe

`describe` creates a block that groups together several related tests.

```typescript
import { describe, test, expect } from 'react-native-harness'

describe('Math operations', () => {
  test('should add numbers', () => {
    expect(2 + 2).toBe(4)
  })
  
  test('should multiply numbers', () => {
    expect(2 * 3).toBe(6)
  })
})
```

### describe.skip

Skip an entire describe block.

```typescript
import { describe, test } from 'react-native-harness'

describe.skip('skipped suite', () => {
  test('will not run', () => {
    // This test will be skipped
  })
})
```

### describe.only

Run only this describe block (and others marked with only).

```typescript
import { describe, test } from 'react-native-harness'

describe.only('focused suite', () => {
  test('will run', () => {
    // Only tests in focused suites will run
  })
})
```

## Setup and Teardown

These functions allow you to hook into the life cycle of tests to avoid repeating setup and teardown code. They apply to the current describe block.

### beforeEach

Register a callback to be called before each of the tests in the current context runs.

```typescript
import { describe, test, beforeEach } from 'react-native-harness'

describe('user tests', () => {
  beforeEach(() => {
    // Clear mocks and add some testing data before each test run
    initializeDatabase()
  })

  test('user can login', () => {
    // Test implementation
  })
})
```

`beforeEach` receives the same `HarnessTestContext` object as the test callback, so you can inspect task metadata or dynamically skip from setup code.

```typescript
import { describe, beforeEach, test } from 'react-native-harness'

describe('user tests', () => {
  beforeEach((context) => {
    context.skip(context.task.name === 'requires seed data', 'Seed data missing')
  })

  test('requires seed data', (context) => {
    // Test implementation
  })
})
```

### afterEach

Register a callback to be called after each one of the tests in the current context completes.

```typescript
import { describe, test, afterEach } from 'react-native-harness'

describe('user tests', () => {
  afterEach(() => {
    // Clear testing data after each test run
    clearDatabase()
  })

  test('user can login', () => {
    // Test implementation
  })
})
```

`afterEach` also receives `HarnessTestContext`, which is useful for cleanup keyed to the current task.

### beforeAll

Register a callback to be called once before starting to run all tests in the current context.

Unlike `test`, `beforeEach`, and `afterEach`, `beforeAll` does not receive a test context because it runs outside any single test case.

```typescript
import { describe, test, beforeAll } from 'react-native-harness'

describe('user tests', () => {
  beforeAll(() => {
    // Called once before all tests run
    setupTestEnvironment()
  })

  test('user can login', () => {
    // Test implementation
  })
})
```

### afterAll

Register a callback to be called once after all tests have run in the current context.

Like `beforeAll`, `afterAll` does not receive a test context.

```typescript
import { describe, test, afterAll } from 'react-native-harness'

describe('user tests', () => {
  afterAll(() => {
    // Called once after all tests run
    teardownTestEnvironment()
  })

  test('user can login', () => {
    // Test implementation
  })
})
```

## Important Notes

- All test functions (`test`, `describe`, lifecycle hooks) must be called within a `describe` block in Harness
- Tests run synchronously by default - use `async/await` for asynchronous operations
- Import all testing functions from `react-native-harness`
