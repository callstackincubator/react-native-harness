# 0002. Run web tests from a project's webpack or Rspack config

- **Status:** Proposed
- **Date:** 2026-11-17
- **Deciders:** React Native Harness maintainers
- **Related:** [#194](https://github.com/callstackincubator/react-native-harness/issues/194) (the request), [#62](https://github.com/callstackincubator/react-native-harness/pull/62) (web support), [#190](https://github.com/callstackincubator/react-native-harness/pull/190) (per-platform Metro config enhancer)

## Context

#194 asks for Harness to run in web projects that are bundled with webpack
and have no Metro setup. These are react-native-web apps whose build depends
on webpack features: aliases, loaders, `DefinePlugin` constants, asset
modules.

Harness cannot run there today. It always starts its own Metro, for the web
runner too:

- `jest/src/harness-session.ts` calls `getMetroInstance` for every session.
  `platform-web/src/runner.ts` only opens a URL in Playwright, and that page
  must load its bundle from the Metro that Harness started
  (`apps/playground/index.html`, `apps/playground/metro.config.js`).
- A project without Metro stops at startup with `MetroNotInstalledError`
  (`bundler-metro/src/utils.ts`).
- The only workaround is a Metro config kept just for Harness, which has to
  re-create the project's aliases, loaders and constants in Metro terms. For
  the projects in #194 that is the blocker.
- `website/src/docs/platforms/web.mdx` says the app can be served by
  `webpack-dev-server`. That has never worked.

### Where Metro is assumed

Paths are as they were before the implementation started.

| Concern | Where |
| --- | --- |
| Swapping the app entry for the Harness entry | `bundler-metro/src/resolvers/resolver.ts` |
| The `RN_HARNESS` manifest global | `bundler-metro/src/manifest.ts`, added as a polyfill in `withRnHarness.ts` |
| One bundle per test file | The runtime fetches `<file>.bundle?modulesOnly=true` and runs it with `eval` (`runtime/src/bundler/bundle.ts`, `evaluate.ts`) |
| Module mocking and reset | `runtime/assets/harness-module-system.js` patches Metro's `__d` and `__r`; `runtime/src/mocker/registry.ts` wraps `__r` |
| `mock('x')` → module id | `babel-preset/src/resolve-weak-plugin.ts`, delivered by wrapping Metro's `babelTransformerPath` |
| Bridge WebSocket | Mounted on Metro's HTTP server at `/__harness`; the runtime derives the URL from the dev-server origin (`runtime/src/utils/dev-server.ts`) |
| Startup and stall detection | Metro reporter events (`bundler-metro/src/startup.ts`, `factory.ts`) |
| Code frames | The runtime posts to Metro's `/symbolicate` (`runtime/src/symbolicate.ts`) |
| React Native internals in the runtime | `HMRClient`, `getDevServer`, `parseErrorStack` and the `ErrorUtils` global (`runtime/src/initialize.ts`, `utils/dev-server.ts`, `symbolicate.ts`) |
| Public names | `metroPort`, `cache.metro`, the `metro:*` plugin hooks, `metroConfigEnhancer` |

The React Native internals resolve on web today only because Metro bundles
the real `react-native` package next to `react-native-web`. A webpack project
aliases `react-native` to `react-native-web` and does not transpile
`node_modules`, so a `react-native/Libraries/...` import fails its build.

### Decision drivers

1. A webpack project runs Harness from its existing webpack config, without
   Metro and without a Metro config.
2. Projects that use Metro today change nothing and see no change in
   behavior.
3. The test API (`mock`, `requireActual`, `render`, setup files, watch mode)
   behaves the same on both bundlers.
4. The user starts one command and Harness uses one port, as today.
5. Knowledge of a specific bundler stays in that bundler's package, so that
   Re.Pack can be added later without another round of extraction.

### Spike

The two riskiest mechanisms, per-file loading and module mocking, were tried
on webpack 5.112.2 and Rspack 1.7.12 with a plugin of about ten lines that
adds the `interceptModuleExecution` and `moduleCache` runtime requirements:

- `mock`, `requireActual`, `unmock` and mocking a dependency of a dependency
  work through `__webpack_require__.i` and the module cache, with ids from
  `require.resolveWeak`, which is what the Babel plugin already emits.
- Deleting a test file's cache entry makes it evaluate again on the next run.
- Test files loaded as async chunks do not carry modules that are already in
  the main chunk.
- A lazy `require.context` cannot be used for the test files: it has no
  `resolve`, so the module id needed for reset is not available.

Three mechanisms the decision relies on were then tried on the same versions:

- **Entry replacement.** With `entry: ['./polyfill.js', './app-entry.js']`
  and a `NormalModuleReplacementPlugin` that matches the resolved path of the
  app entry, the polyfill and the Harness entry run and the app entry does
  not. Webpack calls the plugin both before and after resolving a request.
  Only a replacement made before resolving gives the new module its own
  loaders and module type; step 3 found that one made afterwards keeps the
  app entry's.
- **Loader.** A loader with `enforce: 'pre'` that runs an unmodified copy of
  `resolve-weak-plugin.ts` over `.ts` and `.tsx` source makes `mock('x')`
  work when the project's transpiler is `babel-loader` (webpack) and when it
  is `builtin:swc-loader` (Rspack). Without the loader the mock is not
  applied.
- **Strict ES modules.** In an `.mjs` file, or a `.js` file in a
  `"type": "module"` package, `require.resolveWeak` is not available. The
  build reports no error and the call fails at run time. A rule that sets
  `type: 'javascript/auto'` for those files makes it work on both bundlers.

Everything above was repeated on webpack 5.102.1 and Rspack 1.5.6, the
versions `apps/playground-webpack` resolves, with the same results.

All of this ran with `target: 'node'`, not in a browser. It did not cover
the dev server, source maps or watch mode.

## Considered options

### A. Keep Metro only and document a Metro config for Harness

Rejected. It is the workaround that #194 reports as unworkable. Every webpack
feature the app relies on has to be re-implemented for Metro and kept in
sync, and the tests then run against a different build than the app ships.

### B. A Harness plugin in the dev server the user already runs

Rejected.

- The bridge WebSocket needs a second port, or a hook into a dev server
  whose version Harness does not control.
- Harness cannot see or control the build, so it cannot tell a slow first
  build from an app that never loaded, which is what startup detection
  exists for.
- The dev server's hot-reload client reloads the page while tests run.
- The user has to start a second process. This fails driver 4.

### C. The user builds a bundle that includes the tests, and Harness only drives the browser

Rejected. Tests would no longer load one file at a time, so per-file
isolation, setup files, watch mode and the guarantee that a mock is in place
before a module loads would all be lost or re-invented in user land.

### D. Harness runs the compiler in-process from the project's config (chosen)

This is how Metro is handled today: Harness loads the project's bundler
config, adjusts it, and owns the server. See below.

## Decision

### 1. A `bundler` setting, with Metro as the default

`rn-harness.config` gains an optional `bundler` field. When it is absent,
Harness uses Metro exactly as it does now.

```js
import { webPlatform, chromium } from '@react-native-harness/platform-web';
import { webpackBundler } from '@react-native-harness/bundler-webpack';

export default {
  entryPoint: './src/index.tsx',
  appRegistryComponentName: 'App',
  bundler: webpackBundler({ config: './webpack.config.js' }),
  runners: [
    webPlatform({ name: 'chromium', browser: chromium('http://localhost:8081/') }),
  ],
};
```

A bundler factory returns the same kind of value a platform factory does
(`platforms/src/types.ts`): a plain object with a `name`, a `displayName`
used in messages, a module specifier whose default export creates the
bundler, and the `config` passed to it. The session imports that module
instead of calling into `bundler-metro` directly.

### 2. `@react-native-harness/bundler-webpack`

A new package exports `webpackBundler()` and `rspackBundler()`. `webpack` or
`@rspack/core` is resolved from the project, as Metro is today. Both use the
same implementation, because Rspack passed the same spike unchanged.

The first version supports the web platform only. Selecting this bundler
with a native runner is a configuration error. Re.Pack, which is webpack for
native apps and brings its own dev server, is out of scope and will get its
own record. Nothing here should make it harder.

### 3. Harness owns the server

Harness serves the compilation with `webpack-dev-middleware` on its own HTTP
server, on `metroPort`, and mounts the bridge WebSocket at `/__harness` on the
same server. The page and the bridge share an origin, so the runtime finds
the bridge the same way it does today.

`webpack-dev-server` is not used. Its hot-reload client and error overlay
are unwanted during a test run, and Harness would depend on whichever major
version the project has installed.

As a result, `devServer` options in the project's config (`proxy`, `static`,
`historyApiFallback`, `headers`) are not applied in the first version.

### 4. Composing the project's config

Harness loads the project's config and applies the following. This is the
counterpart of `withRnHarness` in `bundler-metro`.

- `mode: 'development'`.
- A `devtool` that writes a map file with original lines, because the server
  reads that file to build code frames (see 8). The project's setting is
  kept when it is `source-map` or `cheap-module-source-map`, with or without
  `hidden-`. Anything else becomes `source-map`: the `inline-` and `eval-`
  variants write no file, `cheap-source-map` maps to loader output, and
  `nosources-` leaves the code out.
- Module concatenation, export pruning and minification are turned off.
  Mocking needs every module to keep its own factory.
- The module at `entryPoint` is replaced by a generated entry with
  `NormalModuleReplacementPlugin`, before the request is resolved.
  `entryPoint` keeps the meaning it has under Metro, and the rest of
  `entry`, such as a polyfill listed before the app, still runs. If no
  request matches `entryPoint`, or one matches only after resolution (an
  entry reached through an alias), the build fails with an error that says
  how to set `entryPoint`.
- The generated entry sets the `RN_HARNESS` manifest and starts the runtime
  with the test-file manifest (see 5). Generated files are written to
  `.harness/webpack/<port>/`, so two runs in one project do not overwrite
  each other's.
- `@jest/globals` is aliased to the existing module that throws, which
  moved to `@react-native-harness/bundlers/jest-globals-mock` so both
  bundlers share it.
- `webpack` or `@rspack/core` is resolved from the config file's folder
  first, so the compiler and the plugins the config creates come from the
  same copy.
- A small plugin adds the two runtime requirements from the spike, and a
  loader delivers the Babel plugin (see 7).
- Harness's own packages are bundled as `javascript/auto` modules (see
  "Negative and risks").
- A persistent cache (`cache.type: 'filesystem'` in webpack,
  `experiments.cache` in Rspack) gets the loader as a build dependency, and
  a suffix on its version while coverage is collected. The cache keys a
  module by its request, which does not say whether the loader instrumented
  it; without the suffix a plain run followed by `--coverage` reports 0%.
- `watchOptions.ignored` is `**/*` in a one-shot run, so nothing is watched.
  In watch mode the project's value applies, and `**/node_modules` when it
  sets none.

Everything else in the config is left as it is: loaders, aliases, plugins,
constants, asset modules, the HTML plugin.

A config file may export an object, a function or a promise. A config that
exports an array (several compilers) is rejected with an error in the first
version.

### 5. Test files are async chunks listed in a generated manifest

Webpack has no endpoint that bundles an arbitrary file on request. Instead,
Harness generates a module that maps each file to its module id and a loader:

```js
exports.files = {
  'src/__tests__/app.harness.tsx': {
    id: require.resolveWeak('../../../src/__tests__/app.harness.tsx'),
    load: () =>
      new Promise((resolve, reject) => {
        require.ensure(
          ['../../../src/__tests__/app.harness.tsx'],
          () => resolve(),
          (error) => reject(error),
          'harness-src___tests___app.harness.tsx'
        );
      }),
  },
};
```

`require.ensure` fetches the file's chunk and registers its modules without
running them, on webpack and on Rspack. It has to be written with both
callbacks as function expressions and a chunk name as the fourth argument.
Without the chunk name neither bundler recognises the error callback, and
the call fails at run time with only a build warning.

- The manifest lists the test files of the current run and the `setupFiles`
  and `setupFilesAfterEnv` of their Jest projects (`jest/src/run.ts` reads
  them per test). Each becomes its own chunk.
- The session is created before it knows the files (`jest/src/index.ts`
  creates it, then passes `tests` to `executeRun`), and in watch mode one
  session serves many runs (`jest/src/watch-session.ts`). So the session
  gives each run's file list to the bundler before the app is launched. The
  bundler rewrites the manifest only when the set of files changes, and its
  first compilation starts once it has the first list.
- To run a file, the runtime loads its chunk, deletes the file's module
  from the cache and executes it (see 6 for why loading and executing are
  separate steps). Modules the main chunk already holds are not sent again,
  so `skipAlreadyIncludedModules` has no equivalent and needs none.

Alternatives that were rejected:

- **Metro-like endpoint with dynamic entries.** Each test file would be an
  entry added on request. Every new file triggers a recompilation, and the
  entries must be made to share one runtime and one module registry.
- **`require.context`.** See the spike. It also selects files by a regular
  expression, which cannot express Jest's `testMatch` and command-line
  filters.
- **Module Federation.** Far more machinery than the problem needs.

`experiments.lazyCompilation` could later defer compiling a chunk until it is
requested. It is not part of the first version.

### 6. Two seams in the runtime

The runtime is split along two interfaces. The entry module that the bundler
swaps in selects the implementations before anything else runs.

| Seam | Responsibility | Metro | Webpack |
| --- | --- | --- | --- |
| Module system | Load and run a file, reset a module, route `require` through the mock registry | Today's code: fetch, chunked `eval`, patched `__d` and `__r` | The manifest, `__webpack_require__.i`, the module cache |
| Host | Dev-server URL, reload, disabling HMR, the global error handler, stack parsing | Today's code, using React Native internals | Browser APIs only |

The Metro implementations are the current code, moved into
`runtime/src/metro/` with unchanged behavior. The webpack implementations import
nothing from `react-native/Libraries`. A lint rule keeps every file outside
that folder from importing it or naming Metro's and React Native's
internals.

The runtime's `Bundler` has `getModule`, which returns JavaScript text, and
callers pass that text to `evaluateModule`. The module system replaces both
with one call in two phases: `loadModule(path)` returns a handle, and the
handle's `run()` executes the file. The phases stay separate because a test
file is fetched before collection starts and executed inside it, after the
`setupFilesAfterEnv` files, and a failed fetch has to be reported as a
bundling failure, not a collection error. Fetching text and chunked
evaluation are details of the Metro implementation.

For webpack this means `loadModule` has to fetch the test file's chunk
without executing it. A plain `import()` does both, so the manifest uses
`require.ensure` (see 5), and `run()` deletes the module from the cache and
requires it.

The mock registry is created when a test or setup file first imports the
runtime, not when the module system is installed, because that is when
Metro's `__r` is patched today.

### 7. The Babel plugin is unchanged and delivered by a loader

`require.resolveWeak` exists in webpack and Rspack with the meaning the
plugin relies on, so `resolve-weak-plugin.ts` needs no change.

Under Metro the plugin is applied by wrapping the Babel transformer. A
webpack project may not use Babel at all, so Harness adds its own loader with
`enforce: 'pre'`. It parses the source without transforming it, with no
project Babel config, and applies only the Harness plugins. The project's
own transpiler runs afterwards, whichever one it is.

The loader must never be the reason a build fails:

- It runs Babel only on files that contain the text `react-native-harness`.
- It picks the syntax by file extension: JSX for JavaScript files,
  TypeScript with decorators for `.ts`, and both for `.tsx`.
- If a file does not parse, the loader passes it through unchanged with a
  warning, and the project's transpiler reports the real error.

Of the plugins in `babel-preset/src/preset.ts`, this path needs the mock id
rewrite, and `babel-plugin-istanbul` when coverage is collected.

With coverage on, the loader instruments every file it is applied to, not
only those that mention `react-native-harness`. The rule leaves out
`node_modules`, Harness's own packages and the generated files. It
instruments the source as written, before the project's transpiler, so the
report's lines are those of the original file under Babel and under SWC. The
plugin and its options come from one function that `babel-preset` exports
(`@react-native-harness/babel-preset/istanbul-plugin`), so both bundlers
read the same environment variables. `collectCoverageFrom` does not narrow
what is instrumented, as under Metro.

The JSX
import source exists to set `collapsable={false}` on views
(`runtime/src/jsx/jsx-runtime.ts`), which is a native layout concern. The
class static block transform is assumed to be there for engines that lack
the syntax; that should be confirmed before it is left out.

### 8. Symbolication

Harness's server answers `/symbolicate` with the request and response shape
Metro uses, reading the source maps of the current compilation.
`getCodeFrame` in the runtime stays as it is, apart from stack parsing moving
behind the host seam.

- The map of a script is found through the build's stats (the asset's
  related source map), not by appending `.map`, so
  `output.sourceMapFilename` can put it anywhere.
- A source name in a map can be a `webpack://` name, a `file:` URL, an
  absolute path or a path relative to the build's context, depending on
  `devtoolModuleFilenameTemplate`. A relative one counts as a file only if
  the file exists.
- A frame is collapsed when its source is no file (the bundler's runtime),
  is under `node_modules`, or belongs to a Harness package. The code frame
  is taken from the first frame that is not collapsed, as Metro does. Metro
  collapses by its own list of internal paths; collapsing all of
  `node_modules` is broader, and is what points the frame at the test
  rather than at the assertion library.
- A request waits for the compilation to be valid, so it never reads the
  maps of the build before.

### 9. Session and startup detection

`MetroInstance` (`bundler-metro/src/types.ts`) becomes a bundler-neutral
interface in a new package, `@react-native-harness/bundlers`: events,
health, prewarm, whether a build is in flight, and dispose. Health is
reported as `{ healthy, status }`, so each bundler decides what healthy
means and the shared code never reads a bundler's status text.
`waitForMetroBackedAppReady` moves there and is generalized over four
events: build started, build done, build failed, and entry requested. The
webpack compiler's `compile`, `done` and `failed` hooks map onto the first
three. Entry requested is any page navigation the server receives (a `GET`
with `Sec-Fetch-Dest: document`, or one that accepts `text/html` when that
header is absent), because a project may serve its page at a path other
than `/`.

The session gives each run's files to the bundler through one optional
method on the interface, `setRunFiles`, before the app is launched. It
resolves with whether the app has to be reloaded to run them (see 10). Metro
does not implement it.

If the build emits no HTML for a page request, the server answers with a
generated page: an element with the id `root`, then the styles and scripts
of every entrypoint in the order the stats list them. The project's own
HTML is served when there is one.

### 10. Watch mode

After a recompilation the page still holds the chunks it loaded before, so
it has to be reloaded before the next run. Without the reload an edited test
file or app module re-runs as it was, and a test file added during the
session is missing from the page.

The bundler has to know that the build it reports holds every edit made
before the run. It does not compare file timestamps, which misfires on
ignored files and clock skew and needs a timeout to give up. It uses the
compiler's own watcher:

- Each watch run after the first rewrites the manifest with a marker of its
  own, so the file always changes.
- The bundler then waits for a build whose changed files include the
  manifest (`watchRun` and `compiler.modifiedFiles`), and for the compiler
  to have no change pending and no build running. The watcher reports the
  manifest after the edits made before it, so that build holds them too.
  The `invalid` hook cannot be used for this: it names only the first file
  that changed.
- There is no limit on how long a build may take. The one bounded wait is
  for a compiler that stays idle after the manifest was written, which
  means the project's `watchOptions.ignored` covers `.harness`. The limit
  is five seconds plus the project's `aggregateTimeout` and `poll`
  interval. The run then fails with an error that says so. A rebuild forced
  from outside does not read an ignored file on webpack, so there is no
  fallback. The error is thrown out of the run, and Jest's watch loop does
  not start another run after that; the fix is a config change, which
  needs a restart in any case.
- `setRunFiles` resolves with `{ reloadRequired }`. The session, not the
  bundler, reloads the app: through the configured reset strategy, or a
  runtime reload when `resetEnvironmentBetweenTestFiles` is `false`.

A run outside watch mode watches nothing and does not wait.

Because the marker changes the build, every watch run after the first
rebuilds once and reloads the app once, including a re-run with no edits.
With a long `aggregateTimeout` or `poll` interval, each run waits about
that long for its build. A build that fails is reported, and the next build that succeeds recovers.

### 11. Names

| Name | In the first version |
| --- | --- |
| `metroPort`, `--metroPort` | The port for both bundlers. Not renamed. |
| `metro:*` plugin hooks | Fire for Metro, as today. |
| `bundler:*` plugin hooks | New. Fire for every bundler. |
| `cache.metro` | Metro only. Webpack's own `cache` setting stays the project's. |
| `metroConfigEnhancer`, `bundlePlatform`, `deferMetroPrewarm` | Metro only. `platform-web` sets none of them. |

Renaming the Metro-specific options is out of scope.

These features have no webpack counterpart and are not ported: chunked
evaluation from [0001](0001-app-liveness-detection.md) (the browser loads
chunks as scripts; the liveness budgets are unchanged), and the Expo
middleware.

## Consequences

### Positive

- A webpack or Rspack project runs Harness with its own config. Tests run
  against the same aliases, loaders and constants as the app.
- Metro users are not affected. The default does not change and no option is
  renamed.
- The session and the runtime stop depending on one bundler, which is the
  work Re.Pack support would need first.
- Web tests no longer depend on React Native's internal modules being
  bundled into a browser page.

### Negative and risks

- **Two implementations of the module system.** Mocking, reset and file
  loading now exist twice. The sandbox app's tests run on both bundlers to
  hold them together. `mock`, `unmock`, `requireActual` and `resetModules`
  keep the same module instances on both, `resetModules()` clears only
  Harness's own mock state on both, and re-running a file re-evaluates only
  that file.
- **Mocking a dependency of a module that already ran differs.** Measured
  on the Metro playground and the sandbox: a consumer is imported and
  called, then its dependency is mocked and the consumer is called again.
  Metro returns the mock and webpack returns the real module. React
  Native's default Metro config inlines `require` calls, so the consumer
  looks its dependency up on each use; webpack binds an import when the
  importer first runs. A Metro project with inline requires turned off
  behaves like webpack. The pattern that works everywhere is to call
  `mock()` before the consumer is first loaded, and the documentation will
  say so. Making webpack match Metro would mean wrapping every module's
  exports in a proxy, which changes object identity and speed for the whole
  app. A run-time warning was considered and dropped: the page cannot tell
  a consumer that will miss the mock from a module that merely loaded the
  dependency earlier, such as a setup file, so it would fire on correct
  tests.
- **Mocking a default export differs.** For a module imported with a
  default import, a factory that returns the function itself works only on
  Metro, and one that returns `{ default: fn }` works only on webpack.
  `{ __esModule: true, default: fn }` works on both and is what the
  documentation will recommend.
- **All selected test files compile up front.** Metro bundles a file when
  it is asked for. The first test of a large run starts later; total work is
  similar because shared modules compile once.
- **`devServer` options are ignored.** An app that needs `proxy` or `static`
  to start will need them supported before it can adopt this.
- **Harness's packages are ES modules that call `require`.**
  `@react-native-harness/runtime` and `ui` are `"type": "module"` and use
  `require()` in several places (`runtime/src/ui/index.ts`, `initialize.ts`,
  `client/factory.ts`, `ui/src/harness.ts`). Webpack treats such files as
  strict ES modules, where `require` is not handled (see the spike). The
  config composition therefore marks Harness's packages as `javascript/auto`.
- **Test files that are strict ES modules.** In a test file with an `.mjs`
  extension or inside a `"type": "module"` package, `mock('x')` fails at run
  time with no build error. Harness could apply the same `javascript/auto`
  rule to the files in the manifest, but that changes how webpack treats the
  project's own modules and has not been tried against a real project. Until
  it has, this is a documented limitation.
- **The `development` export condition.** Harness's packages declare a
  `development` condition that points at TypeScript source, and webpack adds
  that condition in development mode. In published packages it is listed
  after `import` and is never reached. Inside this repository it is listed
  first, so the sandbox app resolves workspace packages to source. The
  backend should not rely on either order.
- **Projects without an HTML plugin.** `runtime/src/startup.ts` mounts
  into an element with the id `root`, so the generated page (see 9) has
  one. A project whose own page needs other markup has to emit that page.
  A page request for a path the project's HTML does not cover also gets
  the generated page rather than a 404.
- **Watch mode costs a rebuild and a reload per run,** and fails when the
  watcher ignores `.harness` (see 10).
- **Code frames after a rebuild.** `/symbolicate` reads the maps of the
  newest build. A failure reported by a page from the build before can get
  a code frame from the newer source.
- **Code frame columns depend on the project's maps.** With
  `cheap-module-source-map`, or for a module that no loader touches, the
  frame has the right line and points at its start.
- **`react-native` and `metro` are still installed.** `runtime` and `ui`
  declare `react-native` as a required peer, so a react-native-web project
  has to install it at the version that matches its React, although the
  bundle never contains it. `metro` is installed with
  `react-native-harness`, as a peer dependency that npm and pnpm add
  automatically, and is never started. Removing either means
  changing what those packages depend on, which is not part of this work.
- **Plugins that assume a dev server.** A config that always adds
  `HotModuleReplacementPlugin` or a React Refresh plugin has not been tried.
- **Untested configurations.** Module federation hosts, and a config with
  several entrypoints or a non-root `output.publicPath` in a real browser
  (the generated page and the source map lookup cover them in unit tests
  only).

## Implementation plan

Each step can be released on its own.

1. **Bundler interface.** Extract the bundler-neutral instance and startup
   detection from `bundler-metro`, add the `bundler` config field and the
   `bundler:*` hooks, and have the session load the bundler from the config.
   No change in behavior.
2. **Runtime seams.** Introduce the module system and host interfaces with
   the Metro implementations. No change in behavior.
3. **`bundler-webpack`.** Config composition, the plugin, the dev-middleware
   server, the manifest, the webpack implementations of both seams, and the
   loader. The sandbox app's tests pass on webpack and on Rspack in
   Chromium.
4. **Parity.** The `/symbolicate` endpoint, the watch-mode reload, coverage,
   and a page for projects without an HTML plugin.
5. **CI and docs.** Run the sandbox app on both bundlers in CI. Document
   the `bundler` option and the two mocking differences, correct the
   requirements in `web.mdx`, add a version plan.

## Verification

- `apps/playground-webpack` is the acceptance fixture: a react-native-web app
  built by webpack and by Rspack, with no Metro config, that uses an alias, a
  `DefinePlugin` constant and an asset module. Its Harness tests cover the
  three features, rendering, module mocking and setup files. They must pass
  on both bundlers in the web end-to-end job; the app's Harness config picks
  the bundler from the `HARNESS_BUNDLER` environment variable.
- The existing playground suites for web, Android and iOS pass unchanged
  after steps 1 and 2.
- Unit tests: config composition (entry replacement with a multi-item
  `entry`, rejected array configs), manifest generation, and the webpack mock
  registry run under Node as in the spike.
- Step 4: a failing assertion in a module loaded from a test chunk produces
  a code frame with the correct file and line, on both bundlers and with
  each way a config can name map files and sources. Tests build real
  webpack and Rspack compilations for this, for coverage with a persistent
  cache, and for the watch-mode wait.
- Step 4, watch mode: a loop of alternating edits to a test file and to app
  code re-runs each edit and nothing older, on both bundlers, with the
  default watcher and with polling; so do an added test file and a build
  that fails and is then fixed.
