![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

### Native UI Testing Module for React Native Harness

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Native UI testing module for React Native Harness that provides view queries and touch simulation capabilities. This module enables finding UI elements and simulating user interactions in your React Native tests.

## Features

- **View Queries**: Find elements by testID or accessibility label
- **Touch Simulation**: Simulate user presses and text input
- **Screenshot Capture**: Capture screenshots of the entire screen, specific elements, or custom regions
- **Debug-Only**: Automatically excluded from release builds, only available in debug builds

## Installation

```bash
npm install @react-native-harness/ui
# or
pnpm add @react-native-harness/ui
# or
yarn add @react-native-harness/ui
```

## Usage

Import the UI testing utilities in your test files:

```javascript
import { screen, userEvent } from '@react-native-harness/ui';

describe('My Component', () => {
  it('should handle user interactions', async () => {
    // Find elements on screen
    const button = await screen.findByTestId('my-button');
    const input = await screen.findByAccessibilityLabel('Username input');

    // Simulate user interactions
    await userEvent.type(input, 'testuser');
    await userEvent.press(button);

    // Take screenshots for debugging
    const screenshot = await screen.screenshot();

    // Or capture a specific region
    const regionScreenshot = await screen.screenshot({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });
});
```

## API

### `screen`

Provides methods to query and interact with UI elements on screen.

#### `findByTestId(testId: string): Promise<ElementReference>`

Finds an element by its testID (accessibilityIdentifier on iOS, tag on Android).
Throws an error if no element is found.

#### `findAllByTestId(testId: string): Promise<ElementReference[]>`

Finds all elements by testID. Throws an error if no elements are found.

#### `queryByTestId(testId: string): ElementReference | null`

Queries for an element by testID without throwing. Returns null if not found.

#### `queryAllByTestId(testId: string): ElementReference[]`

Queries for all elements by testID without throwing. Returns an empty array if none found.

#### `findByAccessibilityLabel(label: string): Promise<ElementReference>`

Finds an element by its accessibility label. Throws an error if no element is found.

#### `findAllByAccessibilityLabel(label: string): Promise<ElementReference[]>`

Finds all elements by accessibility label. Throws an error if no elements are found.

#### `queryByAccessibilityLabel(label: string): ElementReference | null`

Queries for an element by accessibility label without throwing. Returns null if not found.

#### `queryAllByAccessibilityLabel(label: string): ElementReference[]`

Queries for all elements by accessibility label without throwing. Returns an empty array if none found.

#### `screenshot(target?: ElementReference | BoundingBox): Promise<ScreenshotResult | null>`

Captures a screenshot of the entire app window, a specific element, or a custom region.
Returns a ScreenshotResult with PNG data, or null if capture fails.

> **Warning**: If you are capturing screenshots of elements that extend beyond the screen boundaries (e.g., large scroll views or absolutely positioned views that are partially off-screen), you must disable view flattening in your configuration by setting `disableViewFlattening: true` in your `rn-harness.config.mjs` file.

### `userEvent`

Provides methods to simulate user interactions.

#### `press(element: ElementReference): Promise<void>`

Simulates a press on the given element at its center point.

#### `pressAt(x: number, y: number): Promise<void>`

Simulates a press at the specified screen coordinates.

#### `type(element: ElementReference, text: string, options?: TypeOptions): Promise<void>`

Simulates typing text into a text input element. Focuses the element, types each character, and blurs the element.

**TypeOptions:**

- `skipPress?: boolean` - If true, pressIn and pressOut events will not be triggered
- `skipBlur?: boolean` - If true, endEditing and blur events will not be triggered
- `submitEditing?: boolean` - If true, submitEditing event will be triggered after typing

## Types

### `ElementReference`

An opaque reference to an element found on screen.

### `BoundingBox`

Represents a region on screen.

```typescript
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### `ScreenshotResult`

Screenshot result containing PNG image data.

```typescript
interface ScreenshotResult {
  data: Uint8Array; // PNG image data
  width: number; // Width in logical pixels
  height: number; // Height in logical pixels
}
```

## Requirements

- React Native project with React Native Harness configured
- This module is only available in debug builds and is automatically excluded from release builds

## Made with ❤️ at Callstack

`@react-native-harness/ui` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/@react-native-harness/ui?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/@react-native-harness/ui?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/@react-native-harness/ui
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ../../CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
