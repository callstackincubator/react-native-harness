import { Config, NativeTestRunnerConfig } from './types.js';

export function assertNativeRunner(
  config: Config
): asserts config is Config & { runner: NativeTestRunnerConfig } {
  if (
    config.runner.platform !== 'ios' &&
    config.runner.platform !== 'android'
  ) {
    throw new Error('Runner is not a native runner');
  }
}
