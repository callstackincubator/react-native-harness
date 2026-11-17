import type { EventEmitter as NodeEventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { EventEmitter } from '@react-native-harness/tools';
import type { HarnessPlatform } from '@react-native-harness/platforms';

/**
 * What a bundler factory returns and what goes in the Harness config as
 * `bundler`: a plain, serializable object. `module` is a module specifier (as
 * `import.meta.resolve('./…')` produces) whose default export satisfies
 * {@link HarnessBundlerFactory}. `config` is passed through to it.
 */
export type HarnessBundler<TConfig = Record<string, unknown>> = {
  /** Identifier of the bundler, for example `metro`. */
  name: string;
  /** Name used in messages shown to the user, for example `Metro`. */
  displayName: string;
  module: string;
  config: TConfig;
};

/**
 * A WebSocket server that the bundler mounts on its HTTP server at a path.
 * The bundler hands each matching upgrade request to `handleUpgrade`.
 * `ws`'s `WebSocketServer` satisfies it.
 */
export type BundlerWebSocketEndpoint = NodeEventEmitter & {
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (client: unknown, request: IncomingMessage) => void
  ): void;
};

export type BundlerFactoryOptions<TConfig, THarnessConfig> = {
  /** `HarnessBundler.config`, passed through. */
  config: TConfig;
  projectRoot: string;
  harnessConfig: THarnessConfig;
  /** WebSocket servers to mount, keyed by their URL path. */
  websocketEndpoints: Record<string, BundlerWebSocketEndpoint>;
  /** The selected runner. */
  platform: HarnessPlatform;
  /**
   * Whether Jest is running in watch mode (`--watch` / `--watchAll`). A
   * one-shot run builds once and exits, so file watching can be skipped.
   */
  watchMode: boolean;
};

/**
 * Shape every bundler module's default export must satisfy. The harness
 * session always invokes it as `module.default(options, signal)`.
 */
export type HarnessBundlerFactory<TConfig, THarnessConfig> = (
  options: BundlerFactoryOptions<TConfig, THarnessConfig>,
  signal: AbortSignal
) => Promise<BundlerInstance>;

export type BundlerEntryRequestKind = 'app' | 'prewarm';

export type BundlerClientLogLevel =
  | 'trace'
  | 'info'
  | 'warn'
  | 'log'
  | 'group'
  | 'groupCollapsed'
  | 'groupEnd'
  | 'debug'
  | 'error';

export type BundlerEvent =
  | {
      type: 'build_started';
      /** Correlates this event with the matching `build_done` or `build_failed`. */
      buildId: string;
      platform?: string;
      entryFile?: string;
      dev?: boolean;
    }
  | { type: 'build_done'; buildId: string }
  | { type: 'build_failed'; buildId: string }
  | {
      /** A request for the app's entry bundle. */
      type: 'entry_requested';
      platform: string;
      requestKind: BundlerEntryRequestKind;
    }
  | {
      type: 'client_log';
      level: BundlerClientLogLevel;
      data: unknown[];
    };

export type BundlerEvents = EventEmitter<BundlerEvent>;

export type WaitForBundlerHealthOptions = {
  timeoutMs: number;
  signal: AbortSignal;
};

export type BundlerHealth = {
  healthy: boolean;
  /** Human-readable status, shown when startup stalls. */
  status: string;
};

export type PrewarmBundleOptions = {
  platform: string;
  signal: AbortSignal;
};

export type PrewarmState = 'idle' | 'pending' | 'succeeded' | 'failed';

export type SetRunFilesOptions = {
  /**
   * The files the next run will ask the app to load: its test files and the
   * `setupFiles` and `setupFilesAfterEnv` of their Jest projects. Paths are
   * relative to the project root and use `/`, exactly as the app receives them.
   */
  files: string[];
};

export type SetRunFilesResult = {
  /**
   * The app is already running an older build than the bundler now holds, and
   * keeps what it loaded, so the session reloads it before the run.
   */
  reloadRequired: boolean;
};

export type BundlerInstance = {
  events: BundlerEvents;
  waitUntilHealthy: (
    options: WaitForBundlerHealthOptions
  ) => Promise<BundlerHealth>;
  prewarm: (options: PrewarmBundleOptions) => Promise<boolean>;
  getPrewarmState: () => PrewarmState;
  isBuildInFlight: () => boolean;
  /**
   * Optional. Called with each run's files before the app is launched, for a
   * bundler that has to know the files to compile them (Metro bundles a file
   * when the app asks for it, and does not implement this). Resolves once the
   * bundler has taken the list. A bundler that builds ahead of the app and
   * watches for changes also waits for the build that holds the list and every
   * edit made so far.
   */
  setRunFiles?: (options: SetRunFilesOptions) => Promise<SetRunFilesResult>;
  dispose: () => Promise<void>;
};
