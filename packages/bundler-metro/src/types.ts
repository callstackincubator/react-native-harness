import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { RunServerOptions } from 'metro';
import type { MetroConfig } from 'metro-config';
import type { Reporter } from './reporter.js';
import type { Config as HarnessConfig } from '@react-native-harness/config';

/**
 * Context handed to a platform's Metro config enhancer alongside the composed
 * config. `TPlatformConfig` is the shape of the runner's own `config` block;
 * an enhancer that lives in a platform package types it as that platform's
 * config.
 */
export type MetroConfigEnhancerContext<TPlatformConfig = unknown> = {
  /** Absolute path of the project whose Metro config is being composed. */
  projectRoot: string;
  /** `platformId` of the runner this config is being composed for. */
  platformId: string;
  /** The runner's own `config` block, passed through verbatim. */
  platformConfig: TPlatformConfig;
};

/**
 * The default export of the module a platform points `metroConfigEnhancer` at.
 *
 * The bundler imports that module while composing the Metro config for the
 * selected runner and calls the enhancer with the config it has built so far
 * plus {@link MetroConfigEnhancerContext}. The enhancer returns a
 * further-adjusted config.
 *
 * This is where a platform declares the bundler configuration its own runtime
 * needs — module resolution redirects, additional `resolver.platforms`
 * entries, its own core initialization — so that wiring lives in the platform
 * package instead of in the bundler, which stays unaware of which platforms
 * exist. It runs last, on the fully composed config; whatever it returns is
 * what Metro is started with.
 */
export type MetroConfigEnhancer<TPlatformConfig = unknown> = (
  metroConfig: MetroConfig,
  context: MetroConfigEnhancerContext<TPlatformConfig>
) => MetroConfig | Promise<MetroConfig>;

export type MetroWebSocketEndpoints = NonNullable<
  RunServerOptions['websocketEndpoints']
>;
export type MetroWebSocketEndpoint = MetroWebSocketEndpoints[string];

export type MetroOptions = {
  projectRoot: string;
  harnessConfig: HarnessConfig;
  websocketEndpoints?: MetroWebSocketEndpoints;
  /**
   * `HarnessPlatform.metroConfigEnhancer` for the selected runner, if it sets
   * one: a module specifier the bundler imports and runs against the composed
   * Metro config so the platform can apply the wiring its runtime needs.
   * `platformId` and `platformConfig` are forwarded to it as context.
   */
  metroConfigEnhancer?: string;
  /** `platformId` of the selected runner. Forwarded to `metroConfigEnhancer`. */
  platformId?: string;
  /** The selected runner's `config` block. Forwarded to `metroConfigEnhancer`. */
  platformConfig?: unknown;
  /**
   * Whether Jest is running in watch mode (`--watch` / `--watchAll`). Only
   * then does Metro need a file watcher; a one-shot run bundles once and
   * exits, so watching just costs a watchman subscription and the file-map
   * auto-save timer.
   */
  watchMode?: boolean;
};

export type WaitForMetroHealthOptions = {
  timeoutMs: number;
  signal: AbortSignal;
};

export type PrewarmMetroBundleOptions = {
  platform: string;
  signal: AbortSignal;
};

export type PrewarmState = 'idle' | 'pending' | 'succeeded' | 'failed';

export type MetroInstance = {
  events: Reporter;
  httpServer: HttpServer | HttpsServer;
  websocketEndpoints: MetroWebSocketEndpoints;
  waitUntilHealthy: (options: WaitForMetroHealthOptions) => Promise<string>;
  prewarm: (options: PrewarmMetroBundleOptions) => Promise<boolean>;
  getPrewarmState: () => PrewarmState;
  isBuildInFlight: () => boolean;
  dispose: () => Promise<void>;
};

export type MetroFactory = () => Promise<MetroInstance>;
