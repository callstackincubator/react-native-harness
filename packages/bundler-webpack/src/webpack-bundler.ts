import type { HarnessBundler } from '@react-native-harness/bundlers';
import { COMPILERS } from './compilers.js';
import type { CompilerName } from './compilers.js';
import type { WebpackBundlerConfig } from './types.js';

export const WEBPACK_BUNDLER_NAME = COMPILERS.webpack.bundlerName;
export const RSPACK_BUNDLER_NAME = COMPILERS.rspack.bundlerName;

export type WebpackBundlerOptions = {
  /** Path of the project's webpack or Rspack config file, relative to the project root. */
  config: string;
};

const createDescriptor =
  (compiler: CompilerName) =>
  ({ config }: WebpackBundlerOptions): HarnessBundler<WebpackBundlerConfig> => ({
    name: COMPILERS[compiler].bundlerName,
    displayName: COMPILERS[compiler].displayName,
    module: new URL('./bundler.js', import.meta.url).href,
    config: { compiler, config },
  });

/** Runs the tests from the project's webpack config. */
export const webpackBundler = createDescriptor('webpack');

/** Runs the tests from the project's Rspack config. */
export const rspackBundler = createDescriptor('rspack');
