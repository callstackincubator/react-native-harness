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
import { getErrorMessage } from './logs.js';
import { DeviceNotRespondingError } from '@react-native-harness/bridge/server';
import { NativeCrashError } from './errors.js';

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
        throw getErrorMessage(error);
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

              return onStart(test).then(async () => {
                if (!harnessConfig.detectNativeCrashes) {
                  return runHarnessTestFile({
                    testPath: test.path,
                    harness,
                    globalConfig: this.#globalConfig,
                    projectConfig: test.context.config,
                  });
                }

                // Start crash monitoring
                const crashPromise = harness.crashMonitor.startMonitoring(
                  test.path
                );

                try {
                  const result = await Promise.race([
                    runHarnessTestFile({
                      testPath: test.path,
                      harness,
                      globalConfig: this.#globalConfig,
                      projectConfig: test.context.config,
                    }),
                    crashPromise,
                  ]);

                  return result;
                } finally {
                  harness.crashMonitor.stopMonitoring();
                }
              });
            })
            .then((result) => onResult(test, result))
            .catch(async (err) => {
              if (err instanceof NativeCrashError) {
                onFailure(test, {
                  message: err.message,
                  stack: '',
                });

                // Restart the app for the next test file
                await harness.restart();

                return;
              }

              if (err instanceof DeviceNotRespondingError) {
                onFailure(test, {
                  message: err.message,
                  stack: '',
                });

                return;
              }

              onFailure(test, err);
            })
        ),
      Promise.resolve()
    );
  }
}
