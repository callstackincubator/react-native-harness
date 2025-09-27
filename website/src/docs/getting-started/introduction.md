# Introduction

Before diving deep into React Native Harness and introducing it into your project, it's important to understand when and why to use React Native Harness and how it compares with alternatives.

## What is React Native Harness?

React Native Harness is a testing tool for testing native modules in their native environments (Android, iOS) in a convenient way, using well-known Jest/Vitest syntax. Unlike traditional Jest tests that run in Node.js without access to native functionality, Harness executes your tests directly on real devices and simulators where native modules are available.

For a detailed explanation of the problems with current testing approaches and how Harness solves them, see [Problem Statement](/docs/getting-started/problem-statement).

```javascript
// This test runs on actual iOS/Android devices with real native access
describe('Device Info Module', () => {
  it('should get device model', async () => {
    // ✅ This works - real NativeModules on real device
    const deviceModel = await NativeModules.DeviceInfo.getModel();
    expect(typeof deviceModel).toBe('string');
    expect(deviceModel.length).toBeGreaterThan(0);
  });
});
```

## Design Goals

React Native Harness was designed to provide a way to conveniently test native modules without the need to implement a custom testing workflow with E2E tools like Maestro, which is usually cumbersome and not scalable.

**Our approach:**

- Use familiar Jest/Vitest syntax you already know
- Execute tests directly on real devices with full native access
- No UI automation or complex E2E workflows required
- Fast feedback loop for native module development

## Why & When to Use React Native Harness

React Native Harness should be used when you want to test your native modules or code that heavily relies on native modules. While it's not the best tool to test your application logic (Jest/Vitest are better for that), it can technically be used in those scenarios as well.

**Use React Native Harness when:**

- Testing custom native modules
- Verifying platform-specific functionality (permissions, camera, sensors, etc.)
- Testing third-party native libraries integration
- Validating device-specific behavior

**Consider alternatives when:**

- Testing pure JavaScript logic (use Jest/Vitest)
- Testing UI components without native dependencies (use React Native Testing Library)
- End-to-end user journey testing (use Maestro, Detox, or similar)

For a detailed comparison of testing approaches and when to use each, see our [Feature Comparison](/docs/feature-comparison).

## Getting Started

Ready to start testing native functionality the way it should be tested? Let's get React Native Harness set up in your project.

[Continue to Quick Start](/docs/getting-started/quick-start)
