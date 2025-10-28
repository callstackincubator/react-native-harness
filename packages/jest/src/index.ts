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
import { Config as HarnessConfig } from '@react-native-harness/config';
import { type Harness } from './harness.js';
import { setup } from './setup.js';
import { teardown } from './teardown.js';
import { HarnessError } from '@react-native-harness/tools';

class CancelRun extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'CancelRun';
  }
}

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

    try {
      // This is necessary as Harness may throw and we want to catch it and display a helpful error message.
      await setup(this.#globalConfig);

      const harness = global.HARNESS;
      const harnessConfig = global.HARNESS_CONFIG;

      return await this._createInBandTestRun(
        tests,
        watcher,
        harness,
        harnessConfig,
        onStart,
        onResult,
        onFailure
      );
    } catch (error) {
      if (error instanceof HarnessError) {
        // Jest will print strings as they are, without processing them further.
        throw error.message;
      }

      throw error;
    } finally {
      // This is necessary as Harness may throw and we want to catch it and display a helpful error message.
      await teardown(this.#globalConfig);
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
                await harness.restart();
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
