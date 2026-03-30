# Architecture

React Native Harness is designed to bridge the gap between Node.js-based test runners (like Jest) and the native environment of mobile devices. Understanding how it works demystifies the "magic" and helps you configure it effectively.

## High-Level Overview

At its core, React Native Harness operates by replacing your application's standard Metro bundle with a specialized **Test Bundle**. This bundle contains the Harness Test Runner, which executes tests directly on the device.

The architecture consists of three main components:

1.  **Harness CLI (Node.js)**: Orchestrates the test run, manages the device, and reports results.
2.  **Metro Bundler**: Serves the Test Bundle to the device.
3.  **Harness Native Runner (Device)**: A lightweight runtime injected into your app that executes tests and communicates with the CLI.

## How It Works

### 1. The Test Bundle
When you run `react-native-harness`, the CLI instructs Metro to bundle a special entry point instead of your app's `index.js`. This initial bundle contains:
*   The Harness Test Runner.
*   Your app's native modules (since the native binary is unchanged).

Note that **test files are not included in this initial bundle**. This keeps the initial load fast and allows Harness to manage test isolation and execution dynamically.

### 2. Device Injection
Harness does **not** modify your native code (`.ipa` or `.apk`). Instead, it relies on the standard React Native development mechanism:
1.  The CLI launches your existing Debug app on the simulator/emulator.
2.  The app connects to Metro to download the JavaScript bundle.
3.  Metro serves the **Test Bundle** (the runner).
4.  The app loads the bundle, and instead of rendering your `App.tsx`, it starts the Harness Test Runner.

### 3. The Bridge (WebSocket)
Once the Test Runner starts on the device, it establishes a WebSocket connection back to the Harness CLI through Metro. This bridge is used for:
*   **Control**: The CLI tells the device which tests to run.
*   **Reporting**: The device sends assertions, failures, and logs back to the CLI.
*   **Lifecycle**: The CLI monitors the device for crashes or timeouts.

### 4. Test Execution
Tests are executed **serially** on the device:
1.  The **CLI** sends a command to the **Runtime** (on the device) to run a specific test file.
2.  The **Runtime** requests **Metro** to bundle that specific test file.
3.  The **Runtime** downloads and evaluates the bundled test file.
4.  Tests are executed using the Jest-compatible `describe`/`it` API.
5.  Results are sent back to the **CLI**.

## Key Takeaways

*   **No Native Changes**: You don't need to change your `AppDelegate` or `MainActivity` to use Harness. It works entirely through JavaScript bundle swapping.
*   **Single Runtime**: Tests run in the same JS thread as your app would, ensuring accurate behavior for native module calls.
*   **Debug Builds**: Harness requires a Debug build of your app to load the bundle from Metro. It cannot run on Release builds (which have the bundle pre-packaged).
