![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Vega platform for React Native Harness — runs your harness tests on the Vega Virtual Device and on Fire TV devices running Vega OS.

## Installation

```bash
npm install --save-dev @react-native-harness/platform-vega
# or
pnpm add -D @react-native-harness/platform-vega
# or
yarn add -D @react-native-harness/platform-vega
```

## Usage

Add the Vega platform to your `rn-harness.config.mjs`:

```javascript
import {
  vegaPlatform,
  vegaVirtualDevice,
  vegaPhysicalDevice,
} from '@react-native-harness/platform-vega';

export default {
  entryPoint: './index.js',
  // React Native for Vega runs the component registered under the interactive
  // component id from manifest.toml, so app.json "name" and this value must
  // both be "<packageId>.main".
  appRegistryComponentName: 'com.example.myapp.main',
  runners: [
    vegaPlatform({
      name: 'vega',
      device: vegaVirtualDevice(),
      // The [package] id from manifest.toml
      bundleId: 'com.example.myapp',
    }),
    vegaPlatform({
      name: 'fire-tv',
      // The serial number printed by `vega device list`
      device: vegaPhysicalDevice('G0X1AB1234567890'),
      bundleId: 'com.example.myapp',
    }),
  ],
};
```

Build a Debug package, then point `HARNESS_APP_PATH` at it. The runner
starts the virtual device when needed, installs the package, forwards Metro's
port to the device and launches the app:

```bash
npx react-native build-vega --build-type Debug
HARNESS_APP_PATH=build/aarch64-debug/MyApp_aarch64.vpkg npx react-native-harness --harnessRunner vega
```

Use the `armv7` package for Fire TV devices.

## API

### `vegaPlatform(config)`

**Parameters:**

- `config.name` — unique name for the runner.
- `config.device` — `vegaVirtualDevice(deviceId?)` or `vegaPhysicalDevice(serial)`.
- `config.bundleId` — the `[package] id` from `manifest.toml`. The component id defaults to `<bundleId>.main`.
- `config.componentId` — the `[[components.interactive]] id` from `manifest.toml`. The Vega CLI identifies the app by it for every install and launch step. Defaults to `<bundleId>.main`.
- `config.buildType` — build variant of the package in `HARNESS_APP_PATH`, passed to `vega device install-app --buildType`. Defaults to `Debug`, which Harness needs so the app loads its bundle from Metro.

### `vegaVirtualDevice(deviceId?)`

Targets the Vega Virtual Device. `deviceId` defaults to `VirtualDevice`, the name the SDK uses in `vega device list`.

### `vegaPhysicalDevice(serial)`

Targets a Fire TV device in developer mode by the serial number printed by `vega device list`.

## Requirements

- Vega SDK 0.24 or newer with the `vega` CLI on `PATH` (`source ~/vega/env`), or `KEPLER_SDK_PATH` / `VEGA_CLI_PATH` set.
- An app built with `@amazon-devices/react-native-kepler` 4.x (React Native 0.83) as a Debug `.vpkg`.
- Metro reachable from the device on port 8081. Harness forwards the port itself; if it has to run Metro on another port it maps it with the SDK's `vda` tool.

## Made with ❤️ at Callstack

`react-native-harness` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/react-native-harness?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/react-native-harness?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/react-native-harness
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ./CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
