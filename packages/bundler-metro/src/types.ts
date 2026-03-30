import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { RunServerOptions } from 'metro';
import type { Reporter } from './reporter.js';
import type { Config as HarnessConfig } from '@react-native-harness/config';

export type MetroWebSocketEndpoints = NonNullable<
  RunServerOptions['websocketEndpoints']
>;
export type MetroWebSocketEndpoint = MetroWebSocketEndpoints[string];

export type MetroOptions = {
  projectRoot: string;
  harnessConfig: HarnessConfig;
  websocketEndpoints?: MetroWebSocketEndpoints;
};

export type WaitForMetroHealthOptions = {
  timeoutMs: number;
  signal: AbortSignal;
};

export type PrewarmMetroBundleOptions = {
  platform: string;
  signal: AbortSignal;
};

export type MetroInstance = {
  events: Reporter;
  httpServer: HttpServer | HttpsServer;
  websocketEndpoints: MetroWebSocketEndpoints;
  waitUntilHealthy: (options: WaitForMetroHealthOptions) => Promise<string>;
  prewarm: (options: PrewarmMetroBundleOptions) => Promise<boolean>;
  dispose: () => Promise<void>;
};

export type MetroFactory = () => Promise<MetroInstance>;
