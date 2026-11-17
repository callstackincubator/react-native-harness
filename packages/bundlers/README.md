![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Core bundler abstractions for React Native Harness - the types a bundler package implements and the startup detection that works against any bundler.

> [!NOTE]
> This is an internal package. It is used by `@react-native-harness/jest` and by the bundler packages such as `@react-native-harness/bundler-metro`.

## Usage

A bundler package exports a factory that returns a plain, serializable descriptor. The descriptor names the bundler and points at a module whose default export creates the bundler instance:

```typescript
import type {
  HarnessBundler,
  HarnessBundlerFactory,
} from '@react-native-harness/bundlers';

export const exampleBundler = (): HarnessBundler => ({
  name: 'example',
  displayName: 'Example',
  module: new URL('./bundler.js', import.meta.url).href,
  config: {},
});

// ./bundler.ts
const createBundler: HarnessBundlerFactory<
  Record<string, unknown>,
  HarnessConfig
> = async (options, signal) => ({
  events,
  waitUntilHealthy,
  prewarm,
  getPrewarmState,
  isBuildInFlight,
  dispose,
});

export default createBundler;
```

## API

- `HarnessBundler` - the descriptor placed in the Harness config as `bundler`.
- `HarnessBundlerFactory` - the contract of the module's default export.
- `BundlerInstance` - what Harness uses of a running bundler.
- `BundlerEvent` - the events a bundler reports: build started, done and failed, entry requested, and client log.
- `waitForBundlerBackedAppReady` - startup detection over a `BundlerInstance`.
- `StartupStallError` - thrown when the app does not start in time.

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
