import type { Config as HarnessConfig } from '@react-native-harness/config';

export type ResetStrategyKind = 'process' | 'runtime';

/**
 * Normalizes the `resetEnvironmentBetweenTestFiles` config value into a
 * strategy kind, or `null` when no reset should happen between test files
 * (i.e. the value is `false`).
 */
export const resolveResetStrategyKind = (
  value: HarnessConfig['resetEnvironmentBetweenTestFiles']
): ResetStrategyKind | null => {
  if (value === false) {
    return null;
  }
  if (value === true) {
    return 'process';
  }
  return value;
};
