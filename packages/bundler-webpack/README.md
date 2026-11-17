![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Runs React Native Harness tests from a project's webpack or Rspack config, without Metro. Web only. See the [Webpack and Rspack guide](https://react-native-harness.dev/docs/guides/webpack-and-rspack) for setup, what Harness changes in your config, and the current limits.

```js
import { webpackBundler } from '@react-native-harness/bundler-webpack';
import { webPlatform, chromium } from '@react-native-harness/platform-web';

export default {
  entryPoint: './src/index.tsx',
  appRegistryComponentName: 'App',
  bundler: webpackBundler({ config: './webpack.config.js' }), // or rspackBundler(...)
  runners: [
    webPlatform({ name: 'chromium', browser: chromium('http://localhost:8081/') }),
  ],
};
```

`webpack` or `@rspack/core` is resolved from your project. The config file may export an object, a function or a promise; an array of configurations is rejected.

Harness serves the compilation itself, on `metroPort`. `devServer` options in your config are not applied.

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
