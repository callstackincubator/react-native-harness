# Mocking and Spying

Harness provides comprehensive mocking and spying capabilities through Vitest's `@vitest/spy` package. The API is 100% compatible with Vitest's spy and mock functionality.

## Creating Mock Functions

### fn()

Create a mock function that tracks calls, arguments, and return values.

```typescript
import { describe, test, expect, fn } from 'react-native-harness'

describe('mock functions', () => {
  test('basic mock function', () => {
    const mockFn = fn()
    
    mockFn('arg1', 'arg2')
    mockFn('arg3')
    
    expect(mockFn).toHaveBeenCalledTimes(2)
    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2')
    expect(mockFn).toHaveBeenLastCalledWith('arg3')
  })

  test('mock with implementation', () => {
    const mockFn = fn((x: number, y: number) => x + y)
    
    const result = mockFn(2, 3)
    
    expect(result).toBe(5)
    expect(mockFn).toHaveBeenCalledWith(2, 3)
  })

  test('mock return values', () => {
    const mockFn = fn()
    
    mockFn.mockReturnValue('mocked')
    expect(mockFn()).toBe('mocked')
    
    mockFn.mockReturnValueOnce('once').mockReturnValue('default')
    expect(mockFn()).toBe('once')
    expect(mockFn()).toBe('default')
  })
})
```

## Spying on Existing Methods

### spyOn()

Create a spy that watches calls to an existing method while preserving the original implementation.

```typescript
import { describe, test, expect, spyOn } from 'react-native-harness'

describe('spying', () => {
  test('spy on object method', () => {
    const calculator = {
      add: (a: number, b: number) => a + b
    }
    
    const spy = spyOn(calculator, 'add')
    
    const result = calculator.add(2, 3)
    
    expect(result).toBe(5) // Original implementation still works
    expect(spy).toHaveBeenCalledWith(2, 3)
    expect(spy).toHaveReturnedWith(5)
  })

  test('spy with mock implementation', () => {
    const obj = {
      method: (x: number) => x * 2
    }
    
    const spy = spyOn(obj, 'method').mockImplementation((x: number) => x * 3)
    
    expect(obj.method(4)).toBe(12) // Uses mocked implementation
    expect(spy).toHaveBeenCalledWith(4)
    
    spy.mockRestore() // Restore original implementation
    expect(obj.method(4)).toBe(8) // Back to original
  })
})
```

## Mock Management

### clearAllMocks()

Clear call history for all mocks while keeping their implementations.

```typescript
import { describe, test, expect, fn, clearAllMocks, afterEach } from 'react-native-harness'

describe('mock management', () => {
  afterEach(() => {
    clearAllMocks()
  })

  test('clear all mocks', () => {
    const mock1 = fn()
    const mock2 = fn()
    
    mock1('test')
    mock2('test')
    
    expect(mock1).toHaveBeenCalledTimes(1)
    expect(mock2).toHaveBeenCalledTimes(1)
    
    clearAllMocks()
    
    expect(mock1).toHaveBeenCalledTimes(0)
    expect(mock2).toHaveBeenCalledTimes(0)
    // But implementations are preserved
    expect(typeof mock1).toBe('function')
    expect(typeof mock2).toBe('function')
  })
})
```

### resetAllMocks()

Reset all mocks to their initial state, clearing both call history and implementations.

```typescript
import { test, expect, fn, resetAllMocks } from 'react-native-harness'

test('reset all mocks', () => {
  const mockFn = fn().mockReturnValue('mocked')
  
  expect(mockFn()).toBe('mocked')
  
  resetAllMocks()
  
  expect(mockFn()).toBeUndefined() // Implementation reset
  expect(mockFn).toHaveBeenCalledTimes(0) // Call history cleared
})
```

### restoreAllMocks()

Restore all spied methods to their original implementations.

```typescript
import { test, expect, spyOn, restoreAllMocks } from 'react-native-harness'

test('restore all mocks', () => {
  const obj = {
    method: () => 'original'
  }
  
  const spy = spyOn(obj, 'method').mockReturnValue('mocked')
  
  expect(obj.method()).toBe('mocked')
  
  restoreAllMocks()
  
  expect(obj.method()).toBe('original') // Back to original implementation
})
```

## Spy Assertions

Harness supports all Vitest spy assertions:

```typescript
import { test, expect, fn } from 'react-native-harness'

test('spy assertions', () => {
  const spy = fn()
  
  spy('arg1', 'arg2')
  spy('arg3')
  
  // Call verification
  expect(spy).toHaveBeenCalled()
  expect(spy).toHaveBeenCalledTimes(2)
  expect(spy).toHaveBeenCalledWith('arg1', 'arg2')
  expect(spy).toHaveBeenLastCalledWith('arg3')
  expect(spy).toHaveBeenNthCalledWith(1, 'arg1', 'arg2')
  
  // Return value verification (for functions that return values)
  const returningFn = fn().mockReturnValue('result')
  returningFn()
  
  expect(returningFn).toHaveReturnedWith('result')
  expect(returningFn).toHaveReturnedTimes(1)
})
```

## Complete API Reference

Harness provides the complete Vitest spy and mock API including:

- **Mock Functions**: `fn()`, mock implementations, return values
- **Spying**: `spyOn()`, method restoration
- **Mock Management**: `clearAllMocks()`, `resetAllMocks()`, `restoreAllMocks()`
- **Spy Assertions**: All `toHaveBeenCalled*` and `toHaveReturned*` matchers