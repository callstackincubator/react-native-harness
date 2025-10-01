# Problem Statement

While JavaScript logic can be tested easily with Jest, testing native modules and platform-specific functionality has always been challenging. Let's understand why and how React Native Harness solves it.

## Jest Tests Can't Access Native Modules

Jest tests run in Node.js environment, which means they have no access to native modules or device capabilities:

```javascript
// This Jest test runs in Node.js - no native modules available
describe('Device Info Module', () => {
  it('should get device model', async () => {
    // ❌ This fails - NativeModules doesn't exist in Node.js
    const deviceModel = await NativeModules.DeviceInfo.getModel();
    expect(typeof deviceModel).toBe('string');
  });
});
```

Testing this code would require mocking the whole `NativeModules.DeviceInfo` object, which defeats the purpose of testing this code.

## E2E Tests Work But Require Extra UI Setup

End-to-end testing tools run in real environments with native environment access, but they require cumbersome UI automation. You need to implement some sort of UI that allows you to interact with your native module and execute actions. Then, you need to somehow expose results so you can check them and verify they are correct. This is doable, but not the best developer experience as you need to write and maintain more code than necessary.

```yaml
# Maestro test - indirect and complex
- tapOn: 'Show Device Info'
- assertVisible: 'Device Model:'
- assertVisible: 'iPhone'  # Hope this matches the test device
```

This approach requires complex test scenarios for simple logic and makes it difficult to isolate what you're actually testing.

## We Want To Run JavaScript Tests on Real Devices

What we really want is to run the same tests we write for our apps (or with minimal changes) directly on a device where native modules are available:

```javascript
// The same test, but running on an actual iOS/Android device
describe('Device Info Module', () => {
  it('should get device model', async () => {
    // ✅ This works - real NativeModules on real device
    const deviceModel = await NativeModules.DeviceInfo.getModel();
    expect(typeof deviceModel).toBe('string');
    expect(deviceModel.length).toBeGreaterThan(0);
  });
});
```

We should not be forced to implement any UI. We should be able to write our tests as we do in Jest, and they should execute on a device.

## Getting JavaScript to Run on Devices

JavaScript code needs to be bundled by Metro to run on real devices with the Hermes engine. This means we need to:

- Bundle test files using Metro to create device-compatible bundles
- Create a test runner that can load and execute test files on the device
- Communicate results by sending test results back to the CLI running in Node.js

**This is exactly how React Native Harness works.**

## How React Native Harness Solves These Problems

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

**Jest's Familiar APIs**: Write tests using the same `describe`, `it`, and `expect` syntax you already know, with all the lifecycle hooks and test organization patterns you're familiar with.

**Real Native Environment**: Tests run on actual iOS simulators and Android emulators with full access to native modules, platform APIs, and device capabilities—no mocking required.

**Practical Development**: No complex E2E setup, no UI automation, no brittle selectors. Just write tests that directly call the APIs you want to test.

## Real-World Impact

Before React Native Harness, testing a simple device info call required:

1. **With Jest**: Mock native parts, test the JavaScript logic only
2. **With E2E tools**: Create UI to display info, automate interactions, parse visual results
3. **Manual testing**: Run the app, add console logs, check output

**With React Native Harness**: Write a simple JavaScript test that calls the real API and asserts the result. Done.

## Ready to Get Started?

Now that you understand why React Native Harness exists and how it solves the native testing problem, let's get it set up in your project.

[Continue to Quick Start](/docs/getting-started/quick-start)
