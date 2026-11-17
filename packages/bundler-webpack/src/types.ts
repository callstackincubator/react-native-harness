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
    /** A watched file changed, or a rebuild was asked for. */
    invalid: Tap<() => void>;
    /** Before each watch build; the compiler holds the files that changed for it. */
    watchRun: Tap<(compiler: { modifiedFiles?: ReadonlySet<string> }) => void>;
    compile: Tap<() => void>;
    done: Tap<(stats: CompilerStats) => void>;
    failed: Tap<(error: Error) => void>;
  };
  close: (callback: (error?: Error | null) => void) => void;
  /** Where the build's files are written, and what the config resolves against. */
  outputPath: string;
  options: { context?: string };
};

export type Tap<TCallback> = {
  tap: (name: string, callback: TCallback) => void;
};

/** What `stats.toJson` returns, of the parts Harness reads. */
export type StatsJson = {
  publicPath?: string;
  assets?: Array<{
    name?: string;
    info?: { related?: { sourceMap?: string | string[] } };
  }>;
  entrypoints?: Record<string, { assets?: Array<{ name: string }> }>;
};

export type CompilerStats = {
  hash?: string;
  hasErrors: () => boolean;
  toString: (options?: Record<string, unknown>) => string;
  toJson: (options: Record<string, unknown>) => StatsJson;
};
