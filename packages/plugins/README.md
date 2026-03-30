![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

### Plugins for React Native Harness

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

`@react-native-harness/plugins` provides the plugin API for React Native Harness. It lets you define Harness plugins that react to lifecycle and runtime events such as Harness startup, Metro activity, app lifecycle signals, collection, and test execution.

## Installation

```bash
npm install @react-native-harness/plugins
# or
pnpm add @react-native-harness/plugins
# or
yarn add @react-native-harness/plugins
```

## Usage

Harness plugins are loaded from `rn-harness.config.*` and can run custom Node.js logic around the Harness lifecycle.

```ts
import { definePlugin } from '@react-native-harness/plugins';

export const loggingPlugin = () =>
  definePlugin({
    name: 'logging-plugin',
    hooks: {
      harness: {
        beforeCreation: async (ctx) => {
          ctx.logger.info('Harness is starting for', ctx.platform.platformId);
        },
      },
      run: {
        started: async (ctx) => {
          ctx.logger.info('Run started', ctx.runId);
        },
        finished: async (ctx) => {
          ctx.logger.info('Run finished', ctx.runId, ctx.status);
        },
      },
      testFile: {
        finished: async (ctx) => {
          ctx.logger.info('Finished test file', ctx.file, ctx.status);
        },
      },
    },
  });
```

Then register the plugin in your Harness config:

```ts
import { loggingPlugin } from './logging-plugin';

export default {
  entryPoint: './src/test.ts',
  appRegistryComponentName: 'App',
  runners: [
    {
      name: 'ios',
      runner: '@react-native-harness/platform-ios',
      platformId: 'ios',
      config: {},
    },
  ],
  plugins: [loggingPlugin()],
};
```

## Features

- **Typed plugin API**: Define plugins with `definePlugin()` and get typed plugin contexts
- **Lifecycle plugins API**: React to Harness creation and disposal events
- **Runtime events**: Observe run, Metro, app, collection, suite, and test events
- **Sync or async handlers**: Plugin handlers can be synchronous or asynchronous
- **Plugin-scoped state**: Keep per-plugin state across the Harness process lifetime

## Requirements

- Node.js runtime
- React Native Harness configuration file

## License

MIT

## Made with ❤️ at Callstack

`@react-native-harness/plugins` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/@react-native-harness/plugins?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/@react-native-harness/plugins?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/@react-native-harness/plugins
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ../../CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
