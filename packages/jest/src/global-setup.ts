import {
  getConfig,
  TestRunnerConfig,
  type Config as HarnessConfig,
  type TestRunnerConfig as HarnessTestRunnerConfig,
} from '@react-native-harness/config';
import type { Config as JestConfig } from 'jest-runner';
import {
  getHarness as getHarnessExternal,
  type Harness,
} from '@react-native-harness/cli/external';
import { preRunMessage } from 'jest-util';
import { getAdditionalCliArgs, HarnessCliArgs } from './cli-args.js';
import { logTestEnvironmentReady, logTestRunHeader } from './logs.js';

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
): HarnessTestRunnerConfig => {
  const selectedRunnerName = cliArgs.harnessRunner ?? config.defaultRunner;
  const runner = config.runners.find(
    (runner) => runner.name === selectedRunnerName
  );

  if (!runner) {
    throw new Error(`Runner "${selectedRunnerName}" not found`);
  }

  return runner;
};

const getHarness = async (runner: TestRunnerConfig): Promise<Harness> => {
  return await getHarnessExternal(runner);
};

export default async function (globalConfig: JestConfig.GlobalConfig) {
  preRunMessage.remove(process.stderr);
  const harnessConfig =
    global.HARNESS_CONFIG ?? (await getHarnessConfig(globalConfig));
  const isWatchMode = globalConfig.watch || globalConfig.watchAll;

  if (global.HARNESS) {
    // Do not setup again if HARNESS is already initialized
    // This is useful when running tests in watch mode

    if (harnessConfig.resetEnvironmentBetweenTestFiles) {
      // In watch mode, we want to restart the environment before each test run
      await new Promise((resolve) => {
        global.HARNESS.bridge.once('ready', resolve);
        global.HARNESS.environment.restart();
      });
    }

    return;
  }

  if (isWatchMode) {
    // In watch mode, we want to dispose the Harness when the process exits.
    process.on('exit', async () => {
      await global.HARNESS.bridge.dispose();
      await global.HARNESS.environment.dispose();
    });
  }

  const cliArgs = getAdditionalCliArgs();
  const selectedRunner = getHarnessRunner(harnessConfig, cliArgs);

  if (globalConfig.collectCoverage) {
    // This is going to be used by @react-native-harness/babel-preset
    // to enable instrumentation of test files.
    process.env.RN_HARNESS_COLLECT_COVERAGE = 'true';
  }

  logTestRunHeader(selectedRunner);
  const harness = await getHarness(selectedRunner);
  logTestEnvironmentReady(selectedRunner);

  global.HARNESS_CONFIG = harnessConfig;
  global.HARNESS = harness;
}
