# Defining Tests

This guide covers how to define and organize tests in Harness using test functions, test suites, and lifecycle hooks.

The following types are used in the type signatures below:

```typescript
type TestFn = () => void | Promise<void>
```

When a test function returns a promise, the runner will wait until it is resolved to collect async expectations. If the promise is rejected, the test will fail.

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

### beforeAll

Register a callback to be called once before starting to run all tests in the current context.

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