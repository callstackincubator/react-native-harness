---
name: ui
description: UI testing guidance. Use when the test needs `render(...)`, `rerender(...)`, `@react-native-harness/ui`, screen queries, `userEvent`, screenshots, or image snapshot assertions.
---

# UI

UI testing is opt-in and uses `render(...)` from `react-native-harness` together with `@react-native-harness/ui`.

Use `render(...)` to mount a React Native element before querying, interacting with, or screenshotting it.

- `render(...)` is async
- `rerender(...)` is async
- `unmount()` is optional because cleanup happens automatically after each test
- `wrapper` is the right tool for providers and shared context
- Rendered UI appears as an overlay in the real environment, not as an in-memory tree
- Only one rendered component can be visible at a time

Use this skill when the task requires:

- `render(...)` or `rerender(...)`
- `screen.findByTestId(...)`
- `screen.findAllByTestId(...)`
- `screen.queryByTestId(...)`
- `screen.queryAllByTestId(...)`
- `screen.findByAccessibilityLabel(...)`
- `screen.findAllByAccessibilityLabel(...)`
- `screen.queryByAccessibilityLabel(...)`
- `screen.queryAllByAccessibilityLabel(...)`
- `userEvent.press(...)`
- `userEvent.type(...)`
- screenshots with `screen.screenshot()`
- element screenshots with `screen.screenshot(element)`
- image assertions with `toMatchImageSnapshot(...)`

## Rules

- Keep imports split correctly: core APIs from `react-native-harness`, UI APIs from `@react-native-harness/ui`.
- Mention that `@react-native-harness/ui` requires installation, and native apps must be rebuilt after adding it.
- `toMatchImageSnapshot(...)` needs a unique snapshot `name`.
- If screenshotting elements that extend beyond screen bounds, call out `disableViewFlattening: true` in `rn-harness.config.mjs`.
- On web, UI interactions and screenshots run through the web runner's Playwright-backed browser environment.

## Example

```ts
import { describe, expect, render, test } from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';

describe('Counter', () => {
  test('increments after a press', async () => {
    await render(<Counter />);

    await userEvent.press(await screen.findByTestId('increment-button'));

    expect(await screen.findByTestId('count-label')).toHaveTextContent('1');
  });
});
```
