import type { Config as JestConfig } from 'jest-runner';

export default async function (globalConfig: JestConfig.GlobalConfig) {
  const isWatchMode = globalConfig.watch || globalConfig.watchAll;

  if (isWatchMode) {
    // In watch mode, we don't want to dispose the Harness.

    return;
  }

  await global.HARNESS.bridge.dispose();
  await global.HARNESS.environment.dispose();
}
