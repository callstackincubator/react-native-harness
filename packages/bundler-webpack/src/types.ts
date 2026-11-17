import type { CompilerName } from './compilers.js';

/** What `webpackBundler` and `rspackBundler` put in the descriptor's `config`. */
export type WebpackBundlerConfig = {
  compiler: CompilerName;
  /** Path of the project's config file, relative to the project root. */
  config: string;
};

/**
 * A webpack or Rspack configuration object. Only the parts Harness reads or
 * changes are named; everything else passes through untouched.
 */
export type CompilerConfig = {
  mode?: unknown;
  devtool?: unknown;
  context?: string;
  entry?: unknown;
  resolve?: {
    alias?: unknown;
    modules?: string[];
    [key: string]: unknown;
  };
  module?: {
    rules?: unknown[];
    [key: string]: unknown;
  };
  plugins?: unknown[];
  optimization?: Record<string, unknown>;
  watchOptions?: Record<string, unknown>;
  infrastructureLogging?: Record<string, unknown>;
  [key: string]: unknown;
};

/** The parts of a compiler that Harness uses. */
export type Compiler = {
  hooks: {
    compile: Tap<() => void>;
    done: Tap<(stats: CompilerStats) => void>;
    failed: Tap<(error: Error) => void>;
  };
  close: (callback: (error?: Error | null) => void) => void;
};

export type Tap<TCallback> = {
  tap: (name: string, callback: TCallback) => void;
};

export type CompilerStats = {
  hasErrors: () => boolean;
  toString: (options?: Record<string, unknown>) => string;
};
