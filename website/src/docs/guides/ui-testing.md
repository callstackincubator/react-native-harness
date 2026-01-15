import { PackageManagerTabs } from '@theme';

# UI Testing

React Native Harness provides powerful UI testing capabilities that allow you to test your React Native components visually through screenshot testing and element interaction.

:::warning
UI testing is an **opt-in feature** that requires installing an additional package. The `@react-native-harness/ui` package is not included by default and must be explicitly installed to use these features.

This package contains **native code** and requires rebuilding your app after installation. Additionally, this code is **automatically excluded from release builds** and is only available in debug builds.
:::

## Installation

To enable UI testing in your project, install the UI testing package:

<PackageManagerTabs command="install --save-dev @react-native-harness/ui" />

After installation, **rebuild your app** since this package contains native code that needs to be compiled and linked.

## Screen API

The `screen` object provides methods to query and interact with UI elements in your React Native application. It uses accessibility properties and test IDs to locate elements.

### Element queries

```typescript
import { describe, test, render, expect } from 'react-native-harness';
import { screen } from '@react-native-harness/ui';
import { View, Text } from 'react-native';

describe('Element Queries', () => {
  test('find elements by testID', async () => {
    await render(
      <View>
        <Text testID="welcome-text">Welcome!</Text>
        <Text testID="subtitle">This is a test</Text>
      </View>
    );

    // These methods throw if no element is found
    const welcomeText = screen.findByTestId('welcome-text');
    const subtitle = screen.findByTestId('subtitle');

    // These methods return null if no element is found
    const welcomeTextSafe = screen.queryByTestId('welcome-text');
    const allSubtitles = screen.queryAllByTestId('subtitle');
  });

  test('find elements by accessibility label', async () => {
    await render(
      <View>
        <Text accessibilityLabel="Main heading">Hello World</Text>
      </View>
    );

    const heading = screen.findByAccessibilityLabel('Main heading');
  });
});
```

### Available query methods

| Method | Description |
|--------|-------------|
| `findByTestId(testId)` | Find single element by testID (throws if not found) |
| `findAllByTestId(testId)` | Find all elements by testID (throws if none found) |
| `queryByTestId(testId)` | Find single element by testID (returns null if not found) |
| `queryAllByTestId(testId)` | Find all elements by testID (returns empty array if none found) |
| `findByAccessibilityLabel(label)` | Find single element by accessibility label (throws if not found) |
| `findAllByAccessibilityLabel(label)` | Find all elements by accessibility label (throws if none found) |
| `queryByAccessibilityLabel(label)` | Find single element by accessibility label (returns null if not found) |
| `queryAllByAccessibilityLabel(label)` | Find all elements by accessibility label (returns empty array if none found) |

## Screenshot testing

Screenshot testing allows you to capture and compare visual snapshots of your UI components. This is particularly useful for detecting unexpected visual changes in your components.

### Basic screenshot testing

```typescript
import { describe, test, render, expect } from 'react-native-harness';
import { screen } from '@react-native-harness/ui';
import { View, Text } from 'react-native';

describe('Screenshot Testing', () => {
  test('should match visual snapshot', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          style={{
            width: 100,
            height: 100,
            backgroundColor: 'blue',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white' }}>Hello, world!</Text>
        </View>
      </View>
    );

    const screenshot = await screen.screenshot();
    await expect(screenshot).toMatchImageSnapshot({ name: 'blue-square' });
  });
});
```

### Screenshot options

The `toMatchImageSnapshot` matcher accepts various options to customize the comparison:

```typescript
test('screenshot with custom options', async () => {
  await render(/* your component */);
  const screenshot = await screen.screenshot();

  await expect(screenshot).toMatchImageSnapshot({
    name: 'custom-screenshot',
    threshold: 0.05, // More sensitive comparison (0-1)
    failureThreshold: 0.01, // Minimum difference to trigger failure
    failureThresholdType: 'percent', // 'pixel' or 'percent'
    comparisonMethod: 'ssim', // 'pixelmatch' or 'ssim'
    ssimThreshold: 0.95, // SSIM similarity threshold (0-1)
    diffColor: [255, 0, 0], // RGB color for diff visualization
    ignoreRegions: [
      { x: 10, y: 10, width: 50, height: 50 }, // Ignore specific regions
    ],
  });
});
```

### Screenshot options reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | - | **Required.** Unique name for the snapshot |
| `threshold` | `number` | `0.1` | Matching threshold for pixelmatch (0-1). Smaller values are more sensitive |
| `failureThreshold` | `number` | - | Minimum difference required to fail the test |
| `failureThresholdType` | `'pixel' \| 'percent'` | `'pixel'` | How to interpret the failure threshold |
| `comparisonMethod` | `'pixelmatch' \| 'ssim'` | `'pixelmatch'` | Algorithm used for image comparison |
| `ssimThreshold` | `number` | `0.95` | Minimum similarity for SSIM comparison (0-1) |
| `diffColor` | `[number, number, number]` | `[255, 0, 0]` | RGB color for highlighting differences |
| `ignoreRegions` | `Array<{x,y,width,height}>` | `[]` | Regions to exclude from comparison |

### Element-specific screenshots

You can capture screenshots of specific elements instead of the entire screen:

```typescript
test('capture specific element', async () => {
  await render(
    <View>
      <View testID="header" style={{ backgroundColor: 'red', padding: 20 }}>
        <Text>Header</Text>
      </View>
      <View testID="content" style={{ backgroundColor: 'blue', padding: 20 }}>
        <Text>Content</Text>
      </View>
    </View>
  );

  const headerElement = screen.findByTestId('header');
  const headerScreenshot = await screen.screenshot(headerElement);

  await expect(headerScreenshot).toMatchImageSnapshot({
    name: 'header-element'
  });
});
```

### Multiple screenshots in one test

```typescript
test('multiple screenshots', async () => {
  // Initial render
  await render(<MyComponent color="blue" />);
  const screenshot1 = await screen.screenshot();
  await expect(screenshot1).toMatchImageSnapshot({ name: 'blue-state' });

  // Update component
  await render(<MyComponent color="red" />);
  const screenshot2 = await screen.screenshot();
  await expect(screenshot2).toMatchImageSnapshot({ name: 'red-state' });
});
```

## User interaction testing

The `userEvent` API allows you to simulate user interactions with your components:

```typescript
import { describe, test, render, expect, fn } from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';

describe('User Interactions', () => {
  test('button press', async () => {
    const onPress = fn();

    await render(
      <TouchableOpacity testID="my-button" onPress={onPress}>
        <Text>Press me</Text>
      </TouchableOpacity>
    );

    const button = screen.findByTestId('my-button');
    await userEvent.press(button);

    expect(onPress).toHaveBeenCalled();
  });

  test('text input', async () => {
    await render(<TextInput testID="username-input" />);

    const input = screen.findByTestId('username-input');
    await userEvent.type(input, 'testuser');

    // Verify the input value
    expect(input.props.value).toBe('testuser');
  });
});
```

## Troubleshooting

### Anti-aliased text differences
Small differences in text rendering can cause false positives. Increase the `threshold` value for less sensitive comparison.

### Dynamic content
For components with dynamic content (dates, random values), use `ignoreRegions` to exclude those areas from comparison.