# @react-native-harness/bundler-webpack

Runs React Native Harness tests from a project's webpack or Rspack config, without Metro. Web only. See [ADR 0002](../../docs/adr/0002-webpack-bundler-backend.md) for the design.

> [!NOTE]
> Experimental, and not yet documented on the website.

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
