![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

React Native Windows platform for React Native Harness — runs your harness tests against a deployed React Native Windows app.

## Installation

```bash
npm install --save-dev @react-native-harness/platform-windows
# or
pnpm add -D @react-native-harness/platform-windows
# or
yarn add -D @react-native-harness/platform-windows
```

## Usage

Add the Windows platform to your `rn-harness.config.mjs`:

```javascript
import { windowsPlatform } from '@react-native-harness/platform-windows';

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'MyApp',
  runners: [
    windowsPlatform({
      name: 'windows',
      // Package.appxmanifest Identity/@Name
      packageName: 'MyApp',
    }),
  ],
};
```

Deploy the app before running the harness — the runner launches an already
installed package, it does not build:

```bash
npx react-native run-windows --arch x64 --no-launch --no-packager
npx react-native-harness --harnessRunner windows
```

## API

### `windowsPlatform(config)`

**Parameters:**

- `config.name` — unique name for the runner.
- `config.packageName` — the app's `Identity/@Name` from `Package.appxmanifest`. Used to look the deployed package up with `Get-AppxPackage`.
- `config.appId` — the app's `Application/@Id` from `Package.appxmanifest`. Combined with the package family name into the AUMID used to launch the app. Defaults to `App` (the React Native Windows template value).
- `config.processName` — the app's process name (without `.exe`), for tracking whether it is still running. Defaults to `packageName`.

## Requirements

- Windows 10/11 with the app already deployed (`react-native run-windows`).
- The harness Metro server reachable at the app's configured bundle URL (`http://localhost:8081` by default).

## Made with ❤️ at Callstack

`react-native-harness` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/react-native-harness?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/react-native-harness?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/react-native-harness
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ./CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
