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
};

// `source-map` and its inline, hidden and eval variants have a mapping for
// every position; the `cheap` and `nosources` ones do not.
const COMPLETE_SOURCE_MAP = /^(?:(?:inline|hidden|eval)-)?source-map$/;

const getDevtool = (devtool: unknown): unknown =>
  typeof devtool === 'string' && COMPLETE_SOURCE_MAP.test(devtool)
    ? devtool
    : 'source-map';

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

/** The Harness code is ESM that calls `require`, which webpack rejects in strict ESM. */
const HARNESS_PACKAGE = /^(?:@react-native-harness\/|react-native-harness$)/;
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
  } = options;
  const resolve = userConfig.resolve ?? {};
  const generatedFiles = [harnessEntry, testFilesModule];

  return {
    ...userConfig,
    mode: 'development',
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
          exclude: /node_modules/,
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
    infrastructureLogging: { level: 'warn', ...userConfig.infrastructureLogging },
    // The dev middleware always watches. Watch mode is not supported yet, and
    // a one-shot run has no use for it.
    watchOptions: { ...userConfig.watchOptions, ignored: '**/*' },
  };
};
