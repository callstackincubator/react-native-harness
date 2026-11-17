---
__default__: minor
---

Web tests can now run from your project's webpack or Rspack config, without a Metro config. Install `@react-native-harness/bundler-webpack` and set the new `bundler` option to `webpackBundler({ config })` or `rspackBundler({ config })`. Harness builds your tests with your own aliases, loaders, constants and asset modules, serves them on `metroPort`, and supports watch mode, coverage and code frames for failing assertions. Metro stays the default, and a project that does not set `bundler` behaves as before. The webpack and Rspack bundlers run web tests only, and `devServer` options in your config are not applied. Plugins get new `bundler:*` hooks (`initialized`, `bundle-started`, `bundle-finished`, `bundle-failed` and `client-log`) that fire for every bundler. The `metro:*` hooks keep firing when the bundler is Metro.
