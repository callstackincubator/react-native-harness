# Installation And Setup

Use this reference only when the task involves installing, configuring, or running React Native Harness.

## Install

Install the main package:

```bash
npm install --save-dev react-native-harness
```

Most projects should also install the platform packages they plan to run:

- `@react-native-harness/platform-android`
- `@react-native-harness/platform-apple`
- `@react-native-harness/platform-web`

If the user wants UI queries, interactions, or screenshots, also install:

- `@react-native-harness/ui`

For iOS and Android, adding `@react-native-harness/ui` requires rebuilding the app because it includes debug-only native code.

## Recommended Bootstrap

Prefer the setup wizard first:

```bash
npx react-native-harness@latest init
```

The wizard can generate:

- `rn-harness.config.mjs`
- `jest.harness.config.mjs`
- platform package setup

## Minimal Config Expectations

`rn-harness.config.mjs` should define:

- `entryPoint`
- `appRegistryComponentName`
- `runners`
- optional `defaultRunner`

Typical runner guidance:

- Android: configure `androidPlatform(...)` with `androidEmulator(...)` or `physicalAndroidDevice(...)`
- iOS: configure `applePlatform(...)` with `appleSimulator(...)` or `applePhysicalDevice(...)`
- Web: configure `webPlatform(...)` with a browser helper like `chromium(...)`

`jest.harness.config.mjs` should normally use:

```js
export default {
  preset: 'react-native-harness',
};
```

Common additions:

- `testMatch` for `**/*.harness.[jt]s?(x)`
- `setupFiles`
- `setupFilesAfterEnv`

## Writing Tests

Author tests in files like:

- `feature.harness.ts`
- `feature.harness.tsx`

Import public test APIs from `react-native-harness`.

## Running Tests

Run one runner at a time:

```bash
npx react-native-harness --harnessRunner android
npx react-native-harness --harnessRunner ios
npx react-native-harness --harnessRunner web
```

Helpful supported Jest-style flags include:

- `--watch`
- `--coverage`
- `--testNamePattern`

If `defaultRunner` is configured in `rn-harness.config.mjs`, the runner flag can be omitted.

## Environment Notes

- Harness runs tests in the app or browser environment, not plain Node.
- The app must already be built and installed for native runners.
- Web tests require the target web app dev server to be running.
- Harness can reset the environment between test files by restarting the app when configured with the default isolation behavior.

## Setup Files Guidance

Use `setupFiles` for early polyfills and globals.

Use `setupFilesAfterEnv` for:

- `afterEach(...)`
- `clearAllMocks()`
- `resetModules()`
- shared Harness mocks

## UI Testing Notes

Use `@react-native-harness/ui` for:

- `screen`
- `userEvent`
- screenshot testing

If screenshots need content outside normal screen bounds, mention `disableViewFlattening: true` in `rn-harness.config.mjs`.
