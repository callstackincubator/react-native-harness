import type { Reporter } from './reporter.js';
import type { Config as HarnessConfig } from '@react-native-harness/config';

export type MetroOptions = {
  projectRoot: string;
  harnessConfig: HarnessConfig;
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
  waitUntilHealthy: (options: WaitForMetroHealthOptions) => Promise<string>;
  prewarm: (options: PrewarmMetroBundleOptions) => Promise<boolean>;
  dispose: () => Promise<void>;
};

export type MetroFactory = () => Promise<MetroInstance>;
