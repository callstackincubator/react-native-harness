# Module Mocking

Harness provides powerful module mocking capabilities that allow you to replace entire modules or parts of modules with mock implementations. This is particularly useful for testing React Native code that depends on native modules or third-party libraries.

## mock()

Mock a module by providing a factory function that returns the mock implementation.

```typescript
import { describe, test, expect, mock, fn } from 'react-native-harness'

describe('module mocking', () => {
  test('complete module mock', () => {
    const mockFactory = () => ({
      formatString: fn().mockReturnValue('mocked string'),
      calculateSum: fn().mockImplementation(
        (a: number, b: number) => a + b + 1000
      ),
      constants: {
        VERSION: '999.0.0',
        DEBUG: true,
      },
    })

    mock('react-native', mockFactory)

    const mockedModule = require('react-native')

    expect(mockedModule.formatString()).toBe('mocked string')
    expect(mockedModule.calculateSum(5, 10)).toBe(1015)
    expect(mockedModule.constants.VERSION).toBe('999.0.0')
    expect(mockedModule.formatString).toHaveBeenCalledTimes(1)
  })
})
```

## requireActual()

Get the actual (unmocked) implementation of a module. This is useful for partial mocking where you want to preserve some exports while replacing others.

```typescript
import { describe, test, expect, mock, requireActual, fn } from 'react-native-harness'

describe('partial module mocking', () => {
  test('mock only Platform while keeping other exports', () => {
    const mockFactory = () => {
      // Get the actual react-native module
      const actualRN = requireActual('react-native')

      // Copy without invoking getters to avoid triggering lazy initialization
      const proto = Object.getPrototypeOf(actualRN)
      const descriptors = Object.getOwnPropertyDescriptors(actualRN)

      const mockedRN = Object.create(proto, descriptors)
      const mockedPlatform = {
        OS: 'mockOS',
        Version: 999,
        select: fn().mockImplementation((options: Record<string, any>) => {
          return options.mockOS || options.default
        }),
        isPad: false,
        isTesting: true,
      }
      
      Object.defineProperty(mockedRN, 'Platform', {
        get() {
          return mockedPlatform
        },
      })
      
      return mockedRN
    }

    mock('react-native', mockFactory)

    const mockedRN = require('react-native')

    // Verify Platform is mocked
    expect(mockedRN.Platform.OS).toBe('mockOS')
    expect(mockedRN.Platform.Version).toBe(999)

    // Verify other React Native exports are preserved
    expect(mockedRN).toHaveProperty('View')
    expect(mockedRN).toHaveProperty('Text')
    expect(mockedRN).toHaveProperty('StyleSheet')
  })
})
```

## unmock()

Remove a mock for a specific module, restoring it to its original implementation.

```typescript
import { describe, test, expect, mock, unmock } from 'react-native-harness'

describe('unmocking modules', () => {
  test('unmock a previously mocked module', () => {
    // Mock a module
    const mockFactory = () => ({ mockProperty: 'mocked' })
    mock('react-native', mockFactory)

    // Verify it's mocked
    let module = require('react-native')
    expect(module.mockProperty).toBe('mocked')

    // Unmock it
    unmock('react-native')

    // Verify it's back to actual
    module = require('react-native')
    expect(module).not.toHaveProperty('mockProperty')
    expect(module).toHaveProperty('Platform') // Should have actual RN properties
  })
})
```

## resetModules()

Clear all module mocks and the module cache. This is useful in `afterEach` hooks to ensure tests don't interfere with each other.

```typescript
import { describe, test, expect, mock, resetModules, afterEach } from 'react-native-harness'

describe('module reset', () => {
  afterEach(() => {
    resetModules()
  })

  test('reinitialize module after reset', () => {
    const mockFactory = () => ({ now: Math.random() })

    mock('react-native', mockFactory)

    // Verify mock is active
    const oldNow = require('react-native').now

    // Reset all modules
    resetModules()

    // Require again, should reinitialize the module
    const newNow = require('react-native').now
    expect(newNow).not.toBe(oldNow)
  })
})
```

## Best Practices

1. **Always reset modules in `afterEach`**: Use `resetModules()` in your test cleanup to prevent mocks from leaking between tests.

2. **Use `requireActual` for partial mocks**: When you only need to mock specific exports, use `requireActual()` to preserve the rest of the module.

3. **Factory functions are called lazily**: The factory function is only called when the module is first required, not when `mock()` is called.

4. **Module caching**: Modules are cached after first require. Use `resetModules()` if you need to reinitialize a mocked module.

## API Reference

- **`mock(moduleId: string, factory: () => unknown): void`** - Mock a module with a factory function
- **`unmock(moduleId: string): void`** - Remove a mock for a specific module
- **`requireActual<T = any>(moduleId: string): T`** - Get the actual (unmocked) implementation of a module
- **`resetModules(): void`** - Clear all module mocks and the module cache

