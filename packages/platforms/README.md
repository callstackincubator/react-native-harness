![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Core platform abstractions for React Native Harness - provides the base types and factory functions for creating platform implementations.

## Installation

```bash
npm install @react-native-harness/platforms
# or
pnpm add @react-native-harness/platforms
# or
yarn add @react-native-harness/platforms
```

## Usage

This package provides the core abstractions for creating platform implementations. It's typically used by platform-specific packages rather than directly by end users.

```typescript
import type { HarnessPlatformRunner } from '@react-native-harness/platforms';

const runner: HarnessPlatformRunner = {
  createAppSession: async () => ({
    dispose: async () => {
      /* kill the launched app */
    },
    getState: async () => ({ status: 'running' }),
    getLogs: () => [],
    addListener: () => undefined,
    removeListener: () => undefined,
  }),
  dispose: async () => {
    /* clean up platform resources */
  },
};
```

## API

### `createHarnessPlatform(params)`

Creates a new harness platform instance.

**Parameters:**

- `params.name` - Unique name for the platform
- `params.getInstance` - Function that returns a platform instance

**Returns:** `HarnessPlatform`

### `HarnessPlatform`

Core platform interface.

**Properties:**

- `name` - Platform name
- `getInstance()` - Returns a platform instance

### `HarnessPlatformRunner`

Platform runner interface with lifecycle methods.

**Methods:**

- `createAppSession()` - Launches the application and returns an `AppSession`
- `dispose()` - Cleans up resources

### `AppSession`

One launched application session. Sessions are terminal; restarting means disposing the current session and creating a new one.

**Methods:**

- `dispose()` - Intentionally kills the launched app
- `getState()` - Returns the cached session state
- `getLogs()` - Returns bounded logs for this launched app session
- `addListener()` / `removeListener()` - Subscribes to minimal session lifecycle events

### Error Classes

#### `AppNotInstalledError`

Thrown when an app is not installed on a device.

**Properties:**

- `bundleId` - The bundle ID that wasn't found
- `deviceName` - The device name

#### `DeviceNotFoundError`

Thrown when a device is not found.

**Properties:**

- `deviceName` - The device name that wasn't found

## Requirements

- TypeScript support
- Node.js runtime

## License

MIT

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
