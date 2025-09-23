# Getting Started

React Native Harness allows you to write Jest-style tests that run directly in your React Native app with full access to native modules. Let's get you set up in minutes.

## Installation

Install the required packages as development dependencies:

<PackageManagerTabs
  command="install -D @react-native-harness/metro @react-native-harness/babel-preset @react-native-harness/runtime react-native-harness"
/>

## Configuration

### 1. Create Harness Configuration

Create a `rn-harness.config.mjs` file in your project root:

```javascript
const config = {
  include: ['./src/**/*.harness.{js,ts,jsx,tsx}'],

  runners: [
    {
      name: 'android',
      platform: 'android',
      deviceId: 'Pixel_8_API_35', // Your Android emulator name
      bundleId: 'com.yourapp', // Your Android bundle ID
    },
    {
      name: 'ios',
      platform: 'ios',
      deviceId: 'iPhone 16 Pro', // Your iOS simulator name
      bundleId: 'com.yourapp', // Your iOS bundle ID
      systemVersion: '18.0',
    },
  ],
};

export default config;
```

### 2. Update Metro Configuration

Add the React Native Harness Metro plugin to your `metro.config.js`:

```javascript
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withRnHarness } = require('@react-native-harness/metro');

const defaultConfig = getDefaultConfig(__dirname);

const customConfig = {
  // Your existing Metro config
};

module.exports = withRnHarness(mergeConfig(defaultConfig, customConfig));
```

### 3. Update Babel Configuration

Add the React Native Harness preset to your `babel.config.js`:

```javascript
module.exports = {
  presets: [
    'module:@react-native/babel-preset',
    '@react-native-harness/babel-preset',
  ],
  // Your existing Babel config
};
```

### 4. Update Your Entry Point

Add a conditional entry point to your `index.js` or main entry file:

```javascript
// index.js (or your main entry file)
import { AppRegistry } from 'react-native';

AppRegistry.registerComponent(
  'YourAppName',
  () =>
    global.RN_HARNESS
      ? require('@react-native-harness/runtime').ReactNativeHarness
      : require('./App').default // Your normal app component
);
```

This conditional allows the same bundle to serve both your app and the test runtime. The Babel plugin will optimize this at build time, eliminating dead code branches.

## Writing Your First Test

Create a test file with the `.harness.js` or `.harness.ts` extension. Import testing utilities from `@react-native-harness/runtime` instead of Jest:

```javascript
// MyComponent.harness.js
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@react-native-harness/runtime';
import { NativeModules, Platform } from 'react-native';

describe('My First Harness Test', () => {
  beforeEach(() => {
    console.log('Setting up test...');
  });

  afterEach(() => {
    console.log('Cleaning up test...');
  });

  it('should access platform information', () => {
    expect(Platform.OS).toMatch(/ios|android/);
    expect(typeof Platform.Version).toBe('string');
  });

  it('should have access to native modules', () => {
    // Test real native modules - no mocks!
    expect(NativeModules).toBeDefined();
    expect(typeof NativeModules).toBe('object');
  });

  it('should run async tests', async () => {
    const result = await Promise.resolve('native testing');
    expect(result).toBe('native testing');
  });
});
```

## Available Testing APIs

React Native Harness provides Jest-compatible APIs through `@react-native-harness/runtime`:

### Test Structure

- `describe(name, fn)` - Group related tests
- `it(name, fn)` / `test(name, fn)` - Define individual tests
- `it.skip()` / `test.skip()` - Skip tests
- `it.only()` / `test.only()` - Run only specific tests

### Lifecycle Hooks

- `beforeAll(fn)` - Run once before all tests
- `afterAll(fn)` - Run once after all tests
- `beforeEach(fn)` - Run before each test
- `afterEach(fn)` - Run after each test

### Assertions

- `expect(value)` - Create expectations with matchers like:
  - `.toBe()`, `.toEqual()`, `.toBeTruthy()`, `.toBeFalsy()`
  - `.toContain()`, `.toHaveLength()`, `.toMatch()`
  - `.toBeInstanceOf()`, `.toHaveProperty()`
  - And many more Jest-compatible matchers

## Running Tests

Use the React Native Harness CLI to run your tests:

<PackageManagerTabs
    command="react-native-harness test android"
/>

<PackageManagerTabs
    command="react-native-harness test ios"
/>

## What's Next?

Congratulations! You now have React Native Harness set up and can write tests that run in real native environments.
