import type { Harness } from '@react-native-harness/cli/external';
import type { Config as HarnessConfig } from '@react-native-harness/config';

declare global {
  var HARNESS: Harness;
  var HARNESS_CONFIG: HarnessConfig;
}

export {};
