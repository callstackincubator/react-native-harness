import type { Config as JestConfig } from 'jest-runner';

export const teardown = async (globalConfig: JestConfig.GlobalConfig) => {
  const isWatchMode = globalConfig.watch || globalConfig.watchAll;

  if (isWatchMode) {
    // In watch mode, we don't want to dispose the Harness.
    return;
  }

  if (global.HARNESS) {
    await global.HARNESS.bridge.dispose();
    await global.HARNESS.environment.dispose();
  }
};
