# Rendering Components

This guide covers how to test React Native components using Harness's rendering API, which is inspired by React Native Testing Library.

## Overview

Native module testing isn't just about testing JavaScript APIs - it's also about testing custom Fabric views and ensuring props are properly handled on the native side. When you create native components, you need to verify that props are correctly passed through to the native layer and that your views render as expected on actual iOS and Android devices.

Harness provides a `render` function that allows you to render custom native components directly on the device/simulator for testing. This enables you to test real native view behavior, prop handling, and rendering that's impossible to verify in a Node.js environment like Jest. The rendered components appear as an overlay during test execution and are automatically cleaned up after each test.

## Basic Usage

```typescript
import { describe, it, expect, render } from 'react-native-harness';
import { View, Text } from 'react-native';

describe('MyComponent', () => {
  it('should render successfully', async () => {
    await render(
      <View>
        <Text>Hello World</Text>
      </View>
    );

    // Test passes when component renders without errors
    expect(true).toBe(true);
  });
});
```

## API Reference

### render

Renders a React Native element and returns utilities to interact with it.

```typescript
import { render } from 'react-native-harness';

const { rerender, unmount } = await render(<MyComponent />);
```

### Options

**timeout** - Timeout in milliseconds to wait for the component to mount. Default is `1000ms`.

```typescript
await render(<MyComponent />, { timeout: 2000 });
```

**wrapper** - A React component to wrap the rendered element. Useful for adding context providers.

```typescript
const ThemeProvider = ({ children }) => (
  <ThemeContext.Provider value={{ theme: 'dark' }}>
    {children}
  </ThemeContext.Provider>
);

await render(<MyComponent />, { wrapper: ThemeProvider });
```

### RenderResult

**rerender** - Updates the rendered component with new props without unmounting. The component's internal state is preserved.

```typescript
const { rerender } = await render(<Counter count={0} />);

// Update props without remounting
await rerender(<Counter count={5} />);
```

**unmount** - Manually unmounts the component. This is optional as components are automatically cleaned up after each test.

```typescript
const { unmount } = await render(<MyComponent />);
unmount();
```

## Automatic Cleanup

Components are automatically cleaned up after each test via an `afterEach` hook. You don't need to call `unmount()` unless you want to clean up early.

```typescript
it('test 1', async () => {
  await render(<ComponentA />);
  // No unmount needed
});

it('test 2', async () => {
  // ComponentA was automatically cleaned up
  await render(<ComponentB />);
});
```

## Key Differences from React Native Testing Library

While Harness's render API is inspired by React Native Testing Library, there are some important differences:

### Similarities

- `render()` function returns `{ rerender, unmount }`
- Automatic cleanup after each test
- Awaitable `render()` and `rerender()` functions
- Support for `wrapper` option

### Differences

- **Query functions and user interaction utilities**: Available through the separate [`@react-native-harness/ui` package](/docs/guides/ui-testing) which provides `screen.findByTestId()`, `screen.findByAccessibilityLabel()`, `userEvent.press()`, `userEvent.type()`, and other utilities
- **Visual rendering**: Components are rendered as an overlay on the actual device/simulator, not in-memory
- **Enforces single component**: Only one component can be visible at a time

## Important Notes

- All `render` calls are awaitable and resolve when the component is mounted and laid out
- `rerender` is also awaitable and resolves when the component has updated
- Components are rendered as a full-screen overlay during test execution
- Only one component can be rendered at a time within a test
- The render API is designed for testing component behavior, not for querying or interacting with elements
