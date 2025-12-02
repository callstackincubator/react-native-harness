import type { Reporter } from './reporter.js';
import type { Config as HarnessConfig } from '@react-native-harness/config';

export type MetroOptions = {
  projectRoot: string;
  harnessConfig: HarnessConfig;
};

export type MetroInstance = {
  events: Reporter;
  dispose: () => Promise<void>;
};

export type MetroFactory = () => Promise<MetroInstance>;
