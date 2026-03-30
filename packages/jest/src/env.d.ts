import type { Harness } from './harness.js';
import type { Config as HarnessConfig } from '@react-native-harness/config';

declare global {
  var HARNESS: Harness;
  var HARNESS_CONFIG: HarnessConfig;
}

export {};
