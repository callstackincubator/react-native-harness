import { HARNESS_PACKAGE } from './harness-files.js';
import { HarnessPlugin } from './harness-plugin.js';
import type { CompilerConfig } from './types.js';

export type ComposeOptions = {
  projectRoot: string;
  /** `entryPoint` of the Harness config. */
  entryPoint: string;
  /** The module that replaces the app's entry. */
  harnessEntry: string;
  /** The module that lists the files of the run, required by the Harness entry. */
  testFilesModule: string;
  /** What `@jest/globals` resolves to. */
  jestGlobalsMock: string;
  /** The `enforce: 'pre'` loader that rewrites `mock('x')` to a module id. */
  resolveWeakLoader: string;
  /**
   * A `node_modules` directory to search last, when the project cannot
   * resolve the Harness runtime by itself (strict package layouts).
   */
  fallbackModulesDir?: string;
  /** Whether a file is in one of Harness's own packages, which the loader leaves alone. */
  isHarnessFile: (file: string) => boolean;
  /** Whether the compiler keeps watching after the first build (Jest's watch mode). */
  watch: boolean;
  /**
   * Whether Jest collects coverage, in which case the loader instruments the
   * project's source. Webpack's cache does not know that, so it is told here.
   */
  coverage?: boolean;
};

// The server reads the map file of each script to build code frames, so the
// map has to be a file that maps to the original lines. `cheap-module-` does
// (it lacks columns); `cheap-` alone maps to loader output, and `nosources-`
// leaves out the code. The `inline` and `eval` variants have no file.
const USABLE_SOURCE_MAP = /^(?:hidden-)?(?:cheap-module-)?source-map$/;

const getDevtool = (devtool: unknown): unknown =>
  typeof devtool === 'string' && USABLE_SOURCE_MAP.test(devtool)
    ? devtool
    : 'source-map';

type CacheConfig = {
  type?: string;
  version?: string;
  /** An object of lists in webpack, a list in Rspack. */
  buildDependencies?: Record<string, string[]> | string[];
  [key: string]: unknown;
};

// Webpack's filesystem cache and Rspack's persistent cache key a module by its
// request, and the loader's behavior (instrumenting or not) is not in it. A
// run with coverage gets a cache of its own, and a change of the loader
// invalidates it.
const withCacheIdentity = (
  cache: unknown,
  type: string,
  { loader, coverage }: { loader: string; coverage: boolean }
): unknown => {
  if (!cache || typeof cache !== 'object') {
    return cache;
  }

  const config = cache as CacheConfig;

  if (config.type !== type) {
    return cache;
  }

  return {
    ...config,
    version: `${config.version ?? ''}${coverage ? '+harness-coverage' : ''}`,
    buildDependencies:
      type === 'persistent'
        ? [...((config.buildDependencies as string[] | undefined) ?? []), loader]
        : { ...(config.buildDependencies as object), harnessLoader: [loader] },
  };
};

const withExperiments = (
  experiments: unknown,
  identity: { loader: string; coverage: boolean }
): unknown => {
  const config = experiments as { cache?: unknown } | undefined;

  return config?.cache
    ? { ...config, cache: withCacheIdentity(config.cache, 'persistent', identity) }
    : experiments;
};

type AliasEntry = { name: string; alias: string; onlyModule?: boolean };

const withAliases = (
  alias: unknown,
  ours: Record<string, string>
): unknown => {
  if (Array.isArray(alias)) {
    return [
      ...Object.entries(ours).map(
        ([name, target]): AliasEntry => ({
          name: name.replace(/\$$/, ''),
          alias: target,
          onlyModule: name.endsWith('$'),
        })
      ),
      ...alias,
    ];
  }

  return Object.assign({ ...ours, ...(alias as object | undefined) }, ours);
};

type CompilationWarning = {
  message?: string;
  module?: { resource?: string; userRequest?: string };
};

type IgnoredWarning = RegExp | ((warning: CompilationWarning) => boolean);

const MISSING_REACT_NATIVE_EXPORT =
  /export '[^']+' \(imported as '[^']+'\) was not found in 'react-native'/;
const INSTALLED_HARNESS_FILE =
  /[\\/]node_modules[\\/](?:@react-native-harness|react-native-harness)[\\/]/;

// Harness's runtime and UI packages import native-only exports of
// `react-native`, which a web build aliases to `react-native-web`. The web
// code paths never use them, and the warning is not the project's to fix.
// Only this warning from those packages is dropped.
const createIgnoredWarning =
  (isHarnessFile: (file: string) => boolean): IgnoredWarning =>
  (warning) => {
    const file = warning.module?.resource ?? warning.module?.userRequest;

    return (
      file !== undefined &&
      MISSING_REACT_NATIVE_EXPORT.test(warning.message ?? '') &&
      (isHarnessFile(file) || INSTALLED_HARNESS_FILE.test(file))
    );
  };

const withIgnoredWarnings = (
  ignoreWarnings: unknown,
  ours: IgnoredWarning
): unknown[] => [
  ...(Array.isArray(ignoreWarnings) ? ignoreWarnings : []),
  ours,
];

// The Harness code is ESM that calls `require`, which webpack rejects in
// strict ESM.
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/**
 * Applies what the Harness runtime needs to the project's config and leaves
 * the rest as it is. Pure: it neither reads files nor starts a compiler.
 */
export const composeConfig = (
  userConfig: CompilerConfig,
  options: ComposeOptions
): CompilerConfig => {
  const {
    projectRoot,
    entryPoint,
    harnessEntry,
    testFilesModule,
    jestGlobalsMock,
    resolveWeakLoader,
    fallbackModulesDir,
    isHarnessFile,
    watch,
    coverage = false,
  } = options;
  const resolve = userConfig.resolve ?? {};
  const generatedFiles = [harnessEntry, testFilesModule];
  const identity = { loader: resolveWeakLoader, coverage };

  return {
    ...userConfig,
    mode: 'development',
    ...(userConfig.cache === undefined
      ? {}
      : { cache: withCacheIdentity(userConfig.cache, 'filesystem', identity) }),
    ...(userConfig.experiments === undefined
      ? {}
      : { experiments: withExperiments(userConfig.experiments, identity) }),
    devtool: getDevtool(userConfig.devtool),
    // Mocking needs every module to keep its own factory.
    optimization: {
      ...userConfig.optimization,
      minimize: false,
      concatenateModules: false,
      usedExports: false,
      innerGraph: false,
      sideEffects: false,
    },
    resolve: {
      ...resolve,
      alias: withAliases(resolve.alias, {
        '@jest/globals$': jestGlobalsMock,
      }),
      ...(fallbackModulesDir
        ? { modules: [...(resolve.modules ?? ['node_modules']), fallbackModulesDir] }
        : {}),
    },
    module: {
      ...userConfig.module,
      rules: [
        ...(userConfig.module?.rules ?? []),
        {
          // Runs before the project's own loaders, whichever they are.
          enforce: 'pre',
          test: SOURCE_FILE,
          exclude: [/node_modules/, isHarnessFile, ...generatedFiles],
          loader: resolveWeakLoader,
        },
        {
          test: SOURCE_FILE,
          descriptionData: { name: HARNESS_PACKAGE },
          type: 'javascript/auto',
          // Inside this repository the packages resolve to their TypeScript
          // source (the `development` condition), which imports `./x.js` for
          // `./x.ts`.
          resolve: { extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } },
        },
        {
          include: generatedFiles,
          type: 'javascript/auto',
        },
      ],
    },
    plugins: [
      ...(userConfig.plugins ?? []),
      new HarnessPlugin({
        projectRoot,
        entryPoint,
        harnessEntry,
        entry: userConfig.entry,
      }),
    ],
    ignoreWarnings: withIgnoredWarnings(
      userConfig.ignoreWarnings,
      createIgnoredWarning(isHarnessFile)
    ),
    infrastructureLogging: { level: 'warn', ...userConfig.infrastructureLogging },
    // The dev middleware always watches. A one-shot run has no use for it, so
    // nothing is watched. In watch mode the project's own options apply, and
    // dependencies are left out unless they say otherwise.
    watchOptions: {
      ...userConfig.watchOptions,
      ignored: watch
        ? (userConfig.watchOptions?.ignored ?? '**/node_modules')
        : '**/*',
    },
  };
};
