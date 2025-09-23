# Introduction

React Native development has a testing problem. While JavaScript logic can be tested easily with Jest, testing native modules and platform-specific functionality has always been a challenge. Let's understand why and how React Native Harness solves it.

## The Problem: Jest Tests Can't Access Native Modules

Jest tests run in Node.js, which means they have no access to native modules or device capabilities:

```javascript
// This Jest test runs in Node.js - no native modules available
describe('Camera Module', () => {
  it('should get camera permissions', async () => {
    // ❌ This fails - NativeModules doesn't exist in Node.js
    const hasPermission = await NativeModules.Camera.checkPermissions();
    expect(hasPermission).toBe(true);
  });
});
```

**Why Jest falls short for React Native:**

- ❌ No access to native modules
- ❌ No iOS/Android platform APIs
- ❌ No device-specific functionality
- ❌ Everything must be mocked, nothing is real

## The Alternative: E2E Tools Like Maestro

E2E tools run in real environments with native access, but they require cumbersome UI automation:

```yaml
# Maestro test - indirect and complex
- tapOn: 'Enable Biometrics'
- assertVisible: 'Biometric Prompt'
-  # Hope the system dialog appears correctly
```

**The challenges with E2E approaches:**

- UI automation instead of direct testing
- Slow setup and execution
- Complex test scenarios for simple logic
- Difficult to isolate what you're actually testing

## What We Really Want: Run Tests on Real Devices

What we really want is to run the same test (or with minimal changes) directly on a device where native modules are available:

```javascript
// The same test, but running on an actual iOS/Android device
describe('Camera Module', () => {
  it('should get camera permissions', async () => {
    // ✅ This works - real NativeModules on real device
    const hasPermission = await NativeModules.Camera.checkPermissions();
    expect(hasPermission).toBe(true);
  });
});
```

## The Challenge: Getting JavaScript to Run on Devices

JavaScript code needs to be bundled by Metro to run on real devices in the Hermes engine. This means we need to:

1. **Bundle test files** - Use Metro to create device-compatible bundles
2. **Create a test runner** - Something that can load and execute test files on the device
3. **Communicate results** - Send test results back to the CLI running in Node.js

**This is exactly how React Native Harness works.**

## How React Native Harness Works

### 1. Bundle Test Files with Metro

React Native Harness uses your existing Metro bundler to create a device-compatible bundle that includes:

- Your test files (`.harness.js/.harness.ts`)
- The Harness test runner
- Your app's native modules and dependencies

Instead of bundling your normal app, it bundles a test runtime that can execute tests on the device.

### 2. Run Tests on Real Devices

The CLI installs this test bundle on your target iOS simulator or Android emulator. When the app launches, instead of your normal app UI, the Harness test runner takes control and:

- Loads your test files
- Executes them using familiar Jest-like APIs (`describe`, `it`, `expect`)
- Has full access to native modules because it's running in the real device environment

### 3. Communicate Results Back to CLI

As tests execute on the device, the Harness runtime sends results back to the CLI running in Node.js in real-time. You see the same familiar test output you'd expect from Jest.

## The Best of Both Worlds

This architecture gives you:

**Jest's Familiar APIs**: Write tests using the same `describe`, `it`, and `expect` syntax you already know, with all the lifecycle hooks and test organization patterns you're used to.

**Real Native Environment**: Tests run on actual iOS simulators and Android emulators with full access to native modules, platform APIs, and device capabilities - no mocking required.

**Practical Development**: No complex E2E setup, no UI automation, no brittle selectors. Just write tests that directly call the APIs you want to test.

## Example: Testing Native Modules Made Simple

```javascript
// camera.harness.js - runs on real devices
import { NativeModules } from 'react-native';

describe('Camera Native Module', () => {
  it('should check camera permissions', async () => {
    const hasPermission = await NativeModules.Camera.checkPermissions();
    // This calls the real native module on the device
    expect(typeof hasPermission).toBe('boolean');
  });

  it('should handle different permission states', async () => {
    const status = await NativeModules.Camera.getPermissionStatus();
    // Tests real device state, not mocked values
    expect(['granted', 'denied', 'undetermined']).toContain(status);
  });
});
```

## Getting Started

Ready to close the testing gap? Let's get React Native Harness set up in your project and start testing native functionality the way it should be tested - directly and reliably.

[Continue to Getting Started](/docs/getting-started)
