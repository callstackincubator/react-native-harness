# Migration Guide

This guide helps you migrate from the old CLI-based workflow to the new Jest-based workflow in React Native Harness. The new workflow provides better integration with Jest's testing ecosystem and simplifies the testing setup.

## Overview of Changes

The new Jest-based workflow introduces several key changes:

- **Jest Integration**: React Native Harness now uses Jest as the test runner, giving you access to Jest's full testing capabilities
- **Simplified Configuration**: Less configuration required in your app code
- **Better Test Selection**: Use Jest's powerful test matching patterns instead of a custom `include` property
- **Standardized Setup**: Follows Jest conventions for test configuration

## Migration Steps

### 1. Remove Babel Preset

The `react-native-harness/babel-preset` is **no longer needed** in the new workflow. Remove it from your project:

**Remove from babel.config.js:**

```javascript title="babel.config.js"
module.exports = {
  presets: [
    -'react-native-harness/babel-preset',
    // your other presets
  ],
};
```

### 2. Remove RN_HARNESS Condition

Previously, you needed to conditionally wrap your app with test setup code using the `RN_HARNESS` global variable. This is **no longer required**.

**Before:**

```javascript title="index.js"
import { AppRegistry } from 'react-native';
import App from './App';

// Old approach with RN_HARNESS condition
AppRegistry.registerComponent('MyApp', () =>
  global.RN_HARNESS
    ? require('react-native-harness').ReactNativeHarness
    : require('./App').default
);
```

**After:**

```javascript title="index.js"
import { AppRegistry } from 'react-native';
import App from './App';

// New approach - just register your app normally
AppRegistry.registerComponent('MyApp', () => App);
```

React Native Harness now handles the test setup internally, so you can write your entry point as if Harness doesn't exist. This makes your code cleaner and easier to maintain.

### 3. Update Configuration File

Update your `rn-harness.config.mjs` to include the new required properties.

#### Add Required Properties

Add `entryPoint` and `appRegistryComponentName` to your configuration:

```javascript title="rn-harness.config.mjs"
const config = {
  // NEW: Required properties
  entryPoint: './index.js', // Path to your app's entry point
  appRegistryComponentName: 'MyApp', // Name used in AppRegistry.registerComponent

  runners: [
    {
      name: 'android',
      platform: 'android',
      deviceId: 'Pixel_8_API_35',
      bundleId: 'com.myapp',
    },
    {
      name: 'ios',
      platform: 'ios',
      deviceId: 'iPhone 16 Pro',
      bundleId: 'com.myapp',
      systemVersion: '18.0',
    },
  ],
};

export default config;
```

#### Properties Explained

- **`entryPoint`**: The path to your React Native app's entry point file (typically `index.js` or `src/main.tsx`)
- **`appRegistryComponentName`**: The name you use when calling `AppRegistry.registerComponent('MyApp', () => App)` in your entry point

These properties allow React Native Harness to properly locate and integrate with your app without requiring conditional code in your entry point.

#### Remove `include` Property

The `include` property in `rn-harness.config.mjs` is **no longer supported**. If you were using it to specify which test files to run, remove it:

**Before:**

```javascript title="rn-harness.config.mjs"
const config = {
  include: ['src/**/*.harness.ts', 'tests/**/*.test.ts'], // ❌ No longer supported
  runners: [
    /* ... */
  ],
};
```

**After:**

```javascript title="rn-harness.config.mjs"
const config = {
  // Remove the 'include' property entirely
  runners: [
    /* ... */
  ],
};
```

#### Remove `reporter` Property

The `reporter` property in `rn-harness.config.mjs` is **no longer supported**. Test result reporting is now handled by Jest's built-in reporter system.

**Before:**

```javascript title="rn-harness.config.mjs"
import { junitReporter } from '@react-native-harness/reporters';

const config = {
  reporter: junitReporter, // ❌ No longer supported
  runners: [
    /* ... */
  ],
};

export default config;
```

**After:**

```javascript title="rn-harness.config.mjs"
const config = {
  // Remove the 'reporter' property entirely
  runners: [
    /* ... */
  ],
};

export default config;
```

To configure test result reporting, use Jest's `reporters` configuration instead (see step 4 below).

### 4. Configure Jest

Create or update your `jest.config.js` to use the React Native Harness preset and configure which test files to run.

```javascript title="jest.config.js"
module.exports = {
  projects: [
    {
      preset: 'react-native-harness', // Required preset
      testMatch: [
        // Configure which files Jest should run
        '<rootDir>/src/__tests__/**/*.(test|spec|harness).(js|jsx|ts|tsx)',
        '<rootDir>/tests/**/*.harness.(js|jsx|ts|tsx)',
      ],
      setupFiles: ['./src/setupFile.ts'], // Optional
      setupFilesAfterEnv: ['./src/setupFileAfterEnv.ts'], // Optional
    },
  ],
};
```

## Getting Help

If you run into issues during migration:

- Check the [Configuration documentation](../getting-started/configuration.mdx) for detailed setup information
- Review the [Quick Start guide](../getting-started/quick-start.mdx) for a complete setup example
- Visit the [GitHub repository](https://github.com/callstackincubator/react-native-harness) to report issues or ask questions

---

Since React Native Harness now uses Jest as its test runner, you have access to all of Jest's powerful features and configuration options. For advanced Jest configuration, testing patterns, and troubleshooting, refer to the official [Jest documentation](https://jestjs.io/docs/getting-started). The Jest docs provide comprehensive guides on topics like:

- [Configuring Jest](https://jestjs.io/docs/configuration) for advanced test setups
- [Reporters](https://jestjs.io/docs/configuration#reporters-arraymodulename--modulename-options) for customizing test output

The Jest ecosystem is mature and well-documented, making it easier to find solutions and integrate with other tools in your development workflow.
