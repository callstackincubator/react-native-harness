import type {
  CallbackTestRunnerInterface,
  Config,
  OnTestFailure,
  OnTestStart,
  OnTestSuccess,
  Test,
  TestRunnerOptions,
  TestWatcher,
} from 'jest-runner';
import pLimit from 'p-limit';
import { runHarnessTestFile } from './run.js';
import { getHarness } from '@react-native-harness/cli/external';
import {
  getConfig,
  Config as HarnessConfig,
  TestRunnerConfig as HarnessTestRunnerConfig,
} from '@react-native-harness/config';
import { getAdditionalCliArgs, HarnessCliArgs } from './cli-args.js';
import type { Harness } from '@react-native-harness/cli/external';
import { logTestEnvironmentReady, logTestRunHeader } from './logs.js';

class CancelRun extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'CancelRun';
  }
}

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
export default class JestHarness implements CallbackTestRunnerInterface {
  readonly isSerial = true;

  #globalConfig: Config.GlobalConfig;

  constructor(globalConfig: Config.GlobalConfig) {
    this.#globalConfig = globalConfig;
  }

  async runTests(
    tests: Array<Test>,
    watcher: TestWatcher,
    onStart: OnTestStart,
    onResult: OnTestSuccess,
    onFailure: OnTestFailure,
    options: TestRunnerOptions
  ): Promise<void> {
    if (!options.serial) {
      throw new Error('Parallel test running is not supported');
    }

    const projectRoot = this.#globalConfig.rootDir;
    const { config: harnessConfig } = await getConfig(projectRoot);
    const cliArgs = getAdditionalCliArgs();
    const selectedRunner = getHarnessRunner(harnessConfig, cliArgs);

    logTestRunHeader(selectedRunner);

    if (this.#globalConfig.collectCoverage) {
      // This is going to be used by @react-native-harness/babel-preset
      // to enable instrumentation of test files.
      process.env.RN_HARNESS_COLLECT_COVERAGE = 'true';
    }

    const harness = await getHarness(selectedRunner);

    logTestEnvironmentReady(selectedRunner);

    try {
      return await this._createInBandTestRun(
        tests,
        watcher,
        harness,
        harnessConfig,
        onStart,
        onResult,
        onFailure
      );
    } finally {
      harness.bridge.dispose();
      await harness.environment.dispose();
    }
  }

  async _createInBandTestRun(
    tests: Array<Test>,
    watcher: TestWatcher,
    harness: Harness,
    harnessConfig: HarnessConfig,
    onStart: OnTestStart,
    onResult: OnTestSuccess,
    onFailure: OnTestFailure
  ): Promise<void> {
    const mutex = pLimit(1);
    let isFirstTest = true;

    return tests.reduce(
      (promise, test) =>
        mutex(() =>
          promise
            .then(async () => {
              if (watcher.isInterrupted()) {
                throw new CancelRun();
              }

              if (
                harnessConfig.resetEnvironmentBetweenTestFiles &&
                !isFirstTest
              ) {
                await new Promise((resolve) => {
                  harness.bridge.once('ready', resolve);
                  harness.environment.restart();
                });
              }
              isFirstTest = false;

              return onStart(test).then(() =>
                runHarnessTestFile({
                  testPath: test.path,
                  harness,
                  globalConfig: this.#globalConfig,
                  projectConfig: test.context.config,
                })
              );
            })
            .then((result) => onResult(test, result))
            .catch((err) => onFailure(test, err))
        ),
      Promise.resolve()
    );
  }
}
