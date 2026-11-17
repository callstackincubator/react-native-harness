# Playground Webpack

A small react-native-web app bundled with webpack or Rspack, without Metro. It is the acceptance fixture for the webpack/Rspack bundler backend described in [ADR 0002](../../docs/adr/0002-webpack-bundler-backend.md) (see also issue [#194](https://github.com/callstackincubator/react-native-harness/issues/194)), and the reference for how a webpack or Rspack project is expected to integrate React Native Harness.

The app deliberately uses the three webpack features that are hard to port to Metro:

- a `resolve.alias` path alias (`@app/*` to `src/*`, mirrored in `tsconfig.app.json`),
- a `DefinePlugin` constant (`__BUILD_LABEL__`),
- an asset module (`src/assets/logo.svg`, imported as a URL via `asset/resource`).

`webpack.config.js` (Babel) and `rspack.config.js` (`builtin:swc-loader`) are two self-contained configs for the same app. Both pass the `browserslist` field of `package.json` to their transpiler explicitly, and resolve all paths relative to the config file, so they build from any working directory, so the bundles are modern JavaScript.

## Running the app

```sh
pnpm start:webpack   # dev server on http://localhost:3000
pnpm start:rspack    # dev server on http://localhost:3000
pnpm bundle:webpack  # writes dist/webpack
pnpm bundle:rspack   # writes dist/rspack
```

## `react-native` is only for types

`react-native` is a dev dependency used for TypeScript types only. The bundler resolves `react-native` to `react-native-web`, and `node_modules` is not transpiled. A deep import such as `react-native/Libraries/...` therefore fails the build. This is intended: the fixture should break loudly if Harness's runtime ever pulls React Native internals into a webpack build.

## Status

The Harness tests in `src/__tests__` do not run yet. Harness always starts its own Metro, and the webpack/Rspack backend does not exist. `pnpm test:harness` will fail until it does.

`rn-harness.config.mjs` already has the `chromium` runner pointing at `http://localhost:8081/`. Once the backend exists, uncomment the import and the `bundler` option there:

```js
import { webpackBundler, rspackBundler } from '@react-native-harness/bundler-webpack';

bundler:
  process.env.HARNESS_BUNDLER === 'rspack'
    ? rspackBundler({ config: './rspack.config.js' })
    : webpackBundler({ config: './webpack.config.js' }),
```

The same tests should then pass on both bundlers: run them with `HARNESS_BUNDLER=rspack` for Rspack, or without it for webpack.
