import type {
  DeviceDescriptor,
  SerializedError,
  TestResultStatus,
  TestSuiteResult,
} from '@react-native-harness/bridge';
import type {
  AppCrashDetails,
  AppLaunchOptions,
  HarnessPlatform,
} from '@react-native-harness/platforms';

export type Awaitable<T> = T | Promise<T>;

export type HookLogger = {
  debug: (...messages: unknown[]) => void;
  info: (...messages: unknown[]) => void;
  warn: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
};

export type HarnessRunSummary = {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
};

export type HarnessRunStatus = 'passed' | 'failed';

export type HarnessPlatformMetadata = {
  name: string;
  platformId: string;
};

export type HarnessHookMeta<TName extends string = string> = {
  hook: TName;
  invocationId: string;
  runId?: string;
};

export type HarnessBaseHookContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform,
  TName extends string
> = {
  plugin: {
    name: string;
  };
  logger: HookLogger;
  projectRoot: string;
  config: TConfig;
  runner: TRunner;
  platform: HarnessPlatformMetadata;
  state: TState;
  timestamp: number;
  abortSignal: AbortSignal;
  meta: HarnessHookMeta<TName>;
};

export type HarnessBeforeCreationContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<
  TState,
  TConfig,
  TRunner,
  'harness:before-creation'
> & {
  appLaunchOptions?: AppLaunchOptions;
};

export type HarnessBeforeDisposeContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<
  TState,
  TConfig,
  TRunner,
  'harness:before-dispose'
> & {
  runId?: string;
  reason?: 'normal' | 'abort' | 'error';
  summary?: HarnessRunSummary;
  status?: HarnessRunStatus;
  error?: unknown;
};

export type HarnessBeforeRunContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'harness:before-run'> & {
  appLaunchOptions?: AppLaunchOptions;
};

export type HarnessAfterRunContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'harness:after-run'> & {
  runId?: string;
  reason?: 'normal' | 'abort' | 'error';
  summary?: HarnessRunSummary;
  status?: HarnessRunStatus;
  error?: unknown;
};

export type RunStartedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'run:started'> & {
  runId: string;
  startTime: number;
  testFiles: string[];
  watchMode: boolean;
  coverageEnabled: boolean;
};

export type RunFinishedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'run:finished'> & {
  runId: string;
  startTime: number;
  duration: number;
  testFiles: string[];
  summary: HarnessRunSummary;
  status: HarnessRunStatus;
  error?: unknown;
};

export type RuntimeReadyContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'runtime:ready'> & {
  runId: string;
  device: DeviceDescriptor;
};

export type RuntimeDisconnectedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'runtime:disconnected'> & {
  runId: string;
  reason?: string;
};

export type MetroBundleTarget = 'module' | 'setupFile';

export type MetroClientLogLevel =
  | 'trace'
  | 'info'
  | 'warn'
  | 'log'
  | 'group'
  | 'groupCollapsed'
  | 'groupEnd'
  | 'debug'
  | 'error';

/**
 * The payloads of the bundler hooks, keyed by hook suffix. Every suffix has
 * two hooks with this payload: `metro:<suffix>`, which fires when the bundler
 * is Metro, and `bundler:<suffix>`, which fires for every bundler.
 */
export type BundlerHookPayloads = {
  initialized: { runId: string; port: number; host?: string };
  'bundle-started': {
    runId: string;
    target: MetroBundleTarget;
    file: string;
    setupType?: 'setupFiles' | 'setupFilesAfterEnv';
  };
  'bundle-finished': {
    runId: string;
    target: MetroBundleTarget;
    file: string;
    setupType?: 'setupFiles' | 'setupFilesAfterEnv';
    duration: number;
  };
  'bundle-failed': {
    runId: string;
    target: MetroBundleTarget;
    file: string;
    setupType?: 'setupFiles' | 'setupFilesAfterEnv';
    duration: number;
    error: string;
  };
  'client-log': {
    runId: string;
    level: MetroClientLogLevel;
    data: unknown[];
  };
};

export type BundlerHookSuffix = keyof BundlerHookPayloads;

export type BundlerHookPrefix = 'metro' | 'bundler';

export type BundlerHookContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform,
  TPrefix extends BundlerHookPrefix,
  TSuffix extends BundlerHookSuffix
> = HarnessBaseHookContext<TState, TConfig, TRunner, `${TPrefix}:${TSuffix}`> &
  BundlerHookPayloads[TSuffix];

type CamelCase<TName extends string> = TName extends `${infer A}-${infer B}`
  ? `${A}${Capitalize<B>}`
  : TName;

type BundlerHookGroup<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform,
  TPrefix extends BundlerHookPrefix
> = {
  [TSuffix in BundlerHookSuffix as CamelCase<TSuffix>]?: HarnessHookHandler<
    BundlerHookContext<TState, TConfig, TRunner, TPrefix, TSuffix>
  >;
};

type BundlerHookContexts<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform,
  TPrefix extends BundlerHookPrefix
> = {
  [TSuffix in BundlerHookSuffix as `${TPrefix}:${TSuffix}`]: BundlerHookContext<
    TState,
    TConfig,
    TRunner,
    TPrefix,
    TSuffix
  >;
};

export type MetroInitializedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'metro', 'initialized'>;

export type MetroBundleStartedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'metro', 'bundle-started'>;

export type MetroBundleFinishedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'metro', 'bundle-finished'>;

export type MetroBundleFailedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'metro', 'bundle-failed'>;

export type MetroClientLogContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'metro', 'client-log'>;

export type BundlerBundleTarget = MetroBundleTarget;
export type BundlerClientLogLevel = MetroClientLogLevel;

export type BundlerInitializedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'bundler', 'initialized'>;

export type BundlerBundleStartedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'bundler', 'bundle-started'>;

export type BundlerBundleFinishedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'bundler', 'bundle-finished'>;

export type BundlerBundleFailedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'bundler', 'bundle-failed'>;

export type BundlerClientLogContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = BundlerHookContext<TState, TConfig, TRunner, 'bundler', 'client-log'>;

export type AppStartedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'app:started'> & {
  runId: string;
  testFile?: string;
  pid?: number;
  source?: 'polling' | 'logs';
  line?: string;
};

export type AppExitedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'app:exited'> & {
  runId: string;
  testFile?: string;
  pid?: number;
  source?: 'polling' | 'logs';
  line?: string;
  isConfirmed?: boolean;
  crashDetails?: AppCrashDetails;
};

export type AppPossibleCrashContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'app:possible-crash'> & {
  runId: string;
  testFile?: string;
  pid?: number;
  source?: 'polling' | 'logs';
  line?: string;
  isConfirmed?: boolean;
  crashDetails?: AppCrashDetails;
};

export type CollectionStartedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'collection:started'> & {
  runId: string;
  file: string;
};

export type CollectionFinishedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'collection:finished'> & {
  runId: string;
  file: string;
  duration: number;
  totalTests: number;
};

export type TestFileStartedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'test-file:started'> & {
  runId: string;
  file: string;
};

export type TestFileFinishedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'test-file:finished'> & {
  runId: string;
  file: string;
  duration: number;
  status: TestResultStatus;
  result: TestSuiteResult | null;
};

export type SuiteStartedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'suite:started'> & {
  runId: string;
  file: string;
  name: string;
};

export type SuiteFinishedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'suite:finished'> & {
  runId: string;
  file: string;
  name: string;
  duration: number;
  status: TestResultStatus;
  error?: SerializedError;
};

export type TestStartedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'test:started'> & {
  runId: string;
  file: string;
  suite: string;
  name: string;
};

export type TestFinishedContext<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = HarnessBaseHookContext<TState, TConfig, TRunner, 'test:finished'> & {
  runId: string;
  file: string;
  suite: string;
  name: string;
  duration: number;
  status: TestResultStatus;
  error?: SerializedError;
};

export type FlatHarnessHookContexts<
  TState extends object,
  TConfig,
  TRunner extends HarnessPlatform
> = {
  'harness:before-creation': HarnessBeforeCreationContext<
    TState,
    TConfig,
    TRunner
  >;
  'harness:before-dispose': HarnessBeforeDisposeContext<
    TState,
    TConfig,
    TRunner
  >;
  'harness:before-run': HarnessBeforeRunContext<TState, TConfig, TRunner>;
  'harness:after-run': HarnessAfterRunContext<TState, TConfig, TRunner>;
  'run:started': RunStartedContext<TState, TConfig, TRunner>;
  'run:finished': RunFinishedContext<TState, TConfig, TRunner>;
  'runtime:ready': RuntimeReadyContext<TState, TConfig, TRunner>;
  'runtime:disconnected': RuntimeDisconnectedContext<TState, TConfig, TRunner>;
  'app:started': AppStartedContext<TState, TConfig, TRunner>;
  'app:exited': AppExitedContext<TState, TConfig, TRunner>;
  'app:possible-crash': AppPossibleCrashContext<TState, TConfig, TRunner>;
  'collection:started': CollectionStartedContext<TState, TConfig, TRunner>;
  'collection:finished': CollectionFinishedContext<TState, TConfig, TRunner>;
  'test-file:started': TestFileStartedContext<TState, TConfig, TRunner>;
  'test-file:finished': TestFileFinishedContext<TState, TConfig, TRunner>;
  'suite:started': SuiteStartedContext<TState, TConfig, TRunner>;
  'suite:finished': SuiteFinishedContext<TState, TConfig, TRunner>;
  'test:started': TestStartedContext<TState, TConfig, TRunner>;
  'test:finished': TestFinishedContext<TState, TConfig, TRunner>;
} & BundlerHookContexts<TState, TConfig, TRunner, 'metro'> &
  BundlerHookContexts<TState, TConfig, TRunner, 'bundler'>;

export type FlatHarnessHookName = keyof FlatHarnessHookContexts<
  Record<string, never>,
  unknown,
  HarnessPlatform
>;

export type HarnessHookHandler<TContext> = (ctx: TContext) => Awaitable<void>;

export type HarnessPluginHooks<
  TState extends object = Record<string, never>,
  TConfig = unknown,
  TRunner extends HarnessPlatform = HarnessPlatform
> = {
  harness?: {
    beforeCreation?: HarnessHookHandler<
      HarnessBeforeCreationContext<TState, TConfig, TRunner>
    >;
    beforeRun?: HarnessHookHandler<
      HarnessBeforeRunContext<TState, TConfig, TRunner>
    >;
    afterRun?: HarnessHookHandler<
      HarnessAfterRunContext<TState, TConfig, TRunner>
    >;
    beforeDispose?: HarnessHookHandler<
      HarnessBeforeDisposeContext<TState, TConfig, TRunner>
    >;
  };
  run?: {
    started?: HarnessHookHandler<RunStartedContext<TState, TConfig, TRunner>>;
    finished?: HarnessHookHandler<RunFinishedContext<TState, TConfig, TRunner>>;
  };
  runtime?: {
    ready?: HarnessHookHandler<RuntimeReadyContext<TState, TConfig, TRunner>>;
    disconnected?: HarnessHookHandler<
      RuntimeDisconnectedContext<TState, TConfig, TRunner>
    >;
  };
  metro?: BundlerHookGroup<TState, TConfig, TRunner, 'metro'>;
  bundler?: BundlerHookGroup<TState, TConfig, TRunner, 'bundler'>;
  app?: {
    started?: HarnessHookHandler<AppStartedContext<TState, TConfig, TRunner>>;
    exited?: HarnessHookHandler<AppExitedContext<TState, TConfig, TRunner>>;
    possibleCrash?: HarnessHookHandler<
      AppPossibleCrashContext<TState, TConfig, TRunner>
    >;
  };
  collection?: {
    started?: HarnessHookHandler<
      CollectionStartedContext<TState, TConfig, TRunner>
    >;
    finished?: HarnessHookHandler<
      CollectionFinishedContext<TState, TConfig, TRunner>
    >;
  };
  testFile?: {
    started?: HarnessHookHandler<
      TestFileStartedContext<TState, TConfig, TRunner>
    >;
    finished?: HarnessHookHandler<
      TestFileFinishedContext<TState, TConfig, TRunner>
    >;
  };
  suite?: {
    started?: HarnessHookHandler<SuiteStartedContext<TState, TConfig, TRunner>>;
    finished?: HarnessHookHandler<
      SuiteFinishedContext<TState, TConfig, TRunner>
    >;
  };
  test?: {
    started?: HarnessHookHandler<TestStartedContext<TState, TConfig, TRunner>>;
    finished?: HarnessHookHandler<
      TestFinishedContext<TState, TConfig, TRunner>
    >;
  };
};

export type HarnessPlugin<
  TState extends object = Record<string, never>,
  TConfig = unknown,
  TRunner extends HarnessPlatform = HarnessPlatform
> = {
  name: string;
  hooks?: HarnessPluginHooks<TState, TConfig, TRunner>;
  createState?: () => TState;
};

export const HARNESS_HOOKS = [
  { flatName: 'harness:before-creation', path: ['harness', 'beforeCreation'] },
  { flatName: 'harness:before-run', path: ['harness', 'beforeRun'] },
  { flatName: 'harness:after-run', path: ['harness', 'afterRun'] },
  { flatName: 'harness:before-dispose', path: ['harness', 'beforeDispose'] },
  { flatName: 'run:started', path: ['run', 'started'] },
  { flatName: 'run:finished', path: ['run', 'finished'] },
  { flatName: 'runtime:ready', path: ['runtime', 'ready'] },
  { flatName: 'runtime:disconnected', path: ['runtime', 'disconnected'] },
  { flatName: 'metro:initialized', path: ['metro', 'initialized'] },
  { flatName: 'metro:bundle-started', path: ['metro', 'bundleStarted'] },
  { flatName: 'metro:bundle-finished', path: ['metro', 'bundleFinished'] },
  { flatName: 'metro:bundle-failed', path: ['metro', 'bundleFailed'] },
  { flatName: 'metro:client-log', path: ['metro', 'clientLog'] },
  { flatName: 'bundler:initialized', path: ['bundler', 'initialized'] },
  { flatName: 'bundler:bundle-started', path: ['bundler', 'bundleStarted'] },
  { flatName: 'bundler:bundle-finished', path: ['bundler', 'bundleFinished'] },
  { flatName: 'bundler:bundle-failed', path: ['bundler', 'bundleFailed'] },
  { flatName: 'bundler:client-log', path: ['bundler', 'clientLog'] },
  { flatName: 'app:started', path: ['app', 'started'] },
  { flatName: 'app:exited', path: ['app', 'exited'] },
  { flatName: 'app:possible-crash', path: ['app', 'possibleCrash'] },
  { flatName: 'collection:started', path: ['collection', 'started'] },
  { flatName: 'collection:finished', path: ['collection', 'finished'] },
  { flatName: 'test-file:started', path: ['testFile', 'started'] },
  { flatName: 'test-file:finished', path: ['testFile', 'finished'] },
  { flatName: 'suite:started', path: ['suite', 'started'] },
  { flatName: 'suite:finished', path: ['suite', 'finished'] },
  { flatName: 'test:started', path: ['test', 'started'] },
  { flatName: 'test:finished', path: ['test', 'finished'] },
] as const;
