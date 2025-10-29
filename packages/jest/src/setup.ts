import {
  getConfig,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import type { Config as JestConfig } from 'jest-runner';
import { getHarness as getHarnessExternal, type Harness } from './harness.js';
import { preRunMessage } from 'jest-util';
import { getAdditionalCliArgs, HarnessCliArgs } from './cli-args.js';
import { logTestEnvironmentReady, logTestRunHeader } from './logs.js';
import { NoRunnerSpecifiedError, RunnerNotFoundError } from './errors.js';
import { HarnessPlatform } from '@react-native-harness/platforms';

const getHarnessConfig = async (
  globalConfig: JestConfig.GlobalConfig
): Promise<HarnessConfig> => {
  const projectRoot = globalConfig.rootDir;
  const { config: harnessConfig } = await getConfig(projectRoot);
  return harnessConfig;
};

const getHarnessRunner = (
  config: HarnessConfig,
  cliArgs: HarnessCliArgs
): HarnessPlatform => {
  const selectedRunnerName = cliArgs.harnessRunner ?? config.defaultRunner;

  if (!selectedRunnerName) {
    throw new NoRunnerSpecifiedError();
  }

  const runner = config.runners.find(
    (runner) => runner.name === selectedRunnerName
  );

  if (!runner) {
    throw new RunnerNotFoundError(selectedRunnerName);
  }

  return runner;
};

const getHarness = async (
  runner: HarnessPlatform,
  timeout: number
): Promise<Harness> => {
  return await getHarnessExternal(runner, timeout);
};

export const setup = async (globalConfig: JestConfig.GlobalConfig) => {
  preRunMessage.remove(process.stderr);
  const harnessConfig =
    global.HARNESS_CONFIG ?? (await getHarnessConfig(globalConfig));

  if (global.HARNESS) {
    // Do not setup again if HARNESS is already initialized
    // This is useful when running tests in watch mode

    if (harnessConfig.resetEnvironmentBetweenTestFiles) {
      // In watch mode, we want to restart the environment before each test run
      await global.HARNESS.restart();
    }

    return;
  }

  // Gracefully dispose the Harness when the process exits.
  process.on('exit', async () => {
    await global.HARNESS.dispose();
  });

  const cliArgs = getAdditionalCliArgs();
  const selectedRunner = getHarnessRunner(harnessConfig, cliArgs);

  if (globalConfig.collectCoverage) {
    // This is going to be used by @react-native-harness/babel-preset
    // to enable instrumentation of test files.
    process.env.RN_HARNESS_COLLECT_COVERAGE = 'true';
  }

  logTestRunHeader(selectedRunner);
  const harness = await getHarness(selectedRunner, harnessConfig.bridgeTimeout);
  logTestEnvironmentReady(selectedRunner);

  global.HARNESS_CONFIG = harnessConfig;
  global.HARNESS = harness;
};
