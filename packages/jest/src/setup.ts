import {
  getConfig,
  type Config as HarnessConfig,
  ConfigSchema,
} from '@react-native-harness/config';
import type { Config as JestConfig } from 'jest-runner';
import { getHarness } from './harness.js';
import { preRunMessage } from 'jest-util';
import { getAdditionalCliArgs, HarnessCliArgs } from './cli-args.js';
import { logTestEnvironmentReady, logTestRunHeader } from './logs.js';
import { NoRunnerSpecifiedError, RunnerNotFoundError } from './errors.js';
import { HarnessPlatform } from '@react-native-harness/platforms';
import { logger } from '@react-native-harness/tools';

const setupLogger = logger.child('setup');

const getHarnessConfig = async (
  globalConfig: JestConfig.GlobalConfig
): Promise<HarnessConfig> => {
  const projectRoot = globalConfig.rootDir;
  setupLogger.debug('loading Harness config from %s', projectRoot);
  const { config: harnessConfig } = await getConfig(projectRoot);
  setupLogger.debug('loaded Harness config');
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

  setupLogger.debug('selected runner %s (%s)', runner.name, runner.platformId);
  return runner;
};

export const setup = async (globalConfig: JestConfig.GlobalConfig) => {
  preRunMessage.remove(process.stderr);
  let harnessConfig =
    global.HARNESS_CONFIG ?? (await getHarnessConfig(globalConfig));

  if (global.HARNESS) {
    // Do not setup again if HARNESS is already initialized
    // This is useful when running tests in watch mode

    return;
  }

  // Gracefully dispose the Harness when the process exits.
  process.on('exit', async () => {
    await global.HARNESS.dispose();
  });

  const cliArgs = getAdditionalCliArgs();

  if (cliArgs.metroPort != null) {
    setupLogger.debug('applying CLI metro port override: %d', cliArgs.metroPort);
    harnessConfig = ConfigSchema.parse({
      ...harnessConfig,
      metroPort: cliArgs.metroPort,
    });
  }

  const selectedRunner = getHarnessRunner(harnessConfig, cliArgs);

  if (globalConfig.collectCoverage) {
    // This is going to be used by @react-native-harness/babel-preset
    // to enable instrumentation of test files.
    process.env.RN_HARNESS_COLLECT_COVERAGE = 'true';

    if (harnessConfig.coverage?.root) {
      process.env.RN_HARNESS_COVERAGE_ROOT = harnessConfig.coverage.root;
    }

    setupLogger.debug('coverage enabled for this run');
  }

  if (harnessConfig.disableViewFlattening) {
    process.env.RN_HARNESS_VIEW_FLATTENING = 'false';
    setupLogger.debug('view flattening disabled for runtime');
  }

  logTestRunHeader(selectedRunner);
  setupLogger.debug('creating Harness instance');
  const harness = await getHarness(
    harnessConfig,
    selectedRunner,
    globalConfig.rootDir
  );
  logTestEnvironmentReady(selectedRunner);
  setupLogger.debug('Harness instance is ready');

  global.HARNESS_CONFIG = harnessConfig;
  global.HARNESS = harness;
};
