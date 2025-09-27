# Expect

Harness uses Vitest's `expect` function for making assertions in your tests. The API is 100% compatible with Vitest's expect functionality.

## Basic Usage

```typescript
import { describe, test, expect } from 'react-native-harness'

describe('basic assertions', () => {
  test('primitive values', () => {
    expect(2 + 2).toBe(4)
    expect('hello').toBe('hello')
    expect(true).toBeTruthy()
    expect(false).toBeFalsy()
  })

  test('objects and arrays', () => {
    expect({ name: 'John', age: 30 }).toEqual({ name: 'John', age: 30 })
    expect([1, 2, 3]).toContain(2)
    expect(['apple', 'banana']).toHaveLength(2)
  })

  test('strings and numbers', () => {
    expect('hello world').toContain('world')
    expect('hello world').toMatch(/world/)
    expect(3.14).toBeCloseTo(3.1, 1)
    expect(10).toBeGreaterThan(5)
  })

  test('exceptions', () => {
    const throwError = () => {
      throw new Error('Something went wrong')
    }
    
    expect(throwError).toThrow()
    expect(throwError).toThrow('Something went wrong')
  })
})
```

## Soft Assertions

Use `expect.soft` to continue test execution even when assertions fail:

```typescript
test('soft assertions', () => {
  expect.soft(1 + 1).toBe(3) // This will fail but test continues
  expect.soft(2 + 2).toBe(5) // This will also fail but test continues
  expect(3 + 3).toBe(6) // This passes
  // Test will be marked as failed due to soft assertion failures
})
```

## Complete API Reference

Harness provides the complete Vitest expect API including:

- **Basic matchers**: `toBe`, `toEqual`, `toStrictEqual`
- **Truthiness**: `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`
- **Numbers**: `toBeGreaterThan`, `toBeLessThan`, `toBeCloseTo`
- **Strings**: `toMatch`, `toContain`, `toHaveLength`
- **Arrays/Objects**: `toContain`, `toHaveProperty`, `toMatchObject`
- **Exceptions**: `toThrow`, `toThrowError`
- **Types**: `toBeInstanceOf`, `toBeTypeOf`
- **Asymmetric matchers**: `expect.anything()`, `expect.any()`, `expect.arrayContaining()`, etc.

For the complete documentation of all available matchers and advanced features, please refer to the [Vitest expect documentation](https://vitest.dev/api/expect.html).