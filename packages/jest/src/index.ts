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
import { type Harness, type HarnessRunState } from './harness.js';
import { setup } from './setup.js';
import { teardown } from './teardown.js';
import { HarnessError } from '@react-native-harness/tools';
import { getErrorMessage } from './logs.js';
import { DeviceNotRespondingError } from '@react-native-harness/bridge/server';
import { NativeCrashError, StartupStallError } from './errors.js';
import { logger } from '@react-native-harness/tools';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const runLogger = logger.child('run');

const createRunSummary = () => ({
  passed: 0,
  failed: 0,
  skipped: 0,
  todo: 0,
});

const applyJestResultToSummary = (
  summary: ReturnType<typeof createRunSummary>,
  result: {
    numPassingTests: number;
    numFailingTests: number;
    numPendingTests: number;
    numTodoTests: number;
  }
) => {
  summary.passed += result.numPassingTests;
  summary.failed += result.numFailingTests;
  summary.skipped += result.numPendingTests;
  summary.todo += result.numTodoTests;
};

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
    const startTime = Date.now();
    const runId = randomUUID();
    const watchMode = this.#globalConfig.watch || this.#globalConfig.watchAll;
    const rootDir = this.#globalConfig.rootDir ?? process.cwd();
    const testFiles = tests.map((test) =>
      path.relative(rootDir, test.path)
    );
    const summary = createRunSummary();
    const updateRunState = (overrides: Partial<HarnessRunState> = {}) => {
      const nextRunState: HarnessRunState = {
        runId,
        startTime,
        testFiles,
        watchMode,
        coverageEnabled: this.#globalConfig.collectCoverage,
        summary,
        status: summary.failed > 0 ? 'failed' : 'passed',
        ...overrides,
      };

      harness.setRunState(nextRunState);
      return nextRunState;
    };

    updateRunState();
    runLogger.debug(
      'run started: runId=%s files=%d watchMode=%s coverage=%s',
      runId,
      testFiles.length,
      watchMode,
      this.#globalConfig.collectCoverage
    );
    await harness.callHook('run:started', {
      runId,
      startTime,
      testFiles,
      watchMode,
      coverageEnabled: this.#globalConfig.collectCoverage,
    });
    await harness.callHook('metro:initialized', {
      runId,
      port: harnessConfig.metroPort,
      host: harnessConfig.host?.trim() || undefined,
    });

    try {
      await tests.reduce(
        (promise, test) =>
          mutex(() => {
            let didApplySummary = false;

            return promise
              .then(async () => {
                const relativeTestPath = path.relative(
                  rootDir,
                  test.path
                );
                const testFileStartedAt = Date.now();
                let didEmitTestFileFinished = false;

                await harness.callHook('test-file:started', {
                  runId,
                  file: relativeTestPath,
                });
                runLogger.debug('test file started: %s', relativeTestPath);

                const emitTestFileFinished = async (options: {
                  status: 'passed' | 'failed' | 'skipped' | 'todo';
                  duration: number;
                  result: Awaited<ReturnType<typeof runHarnessTestFile>>['harnessResult'] | null;
                }) => {
                  didEmitTestFileFinished = true;
                  runLogger.debug(
                    'test file finished: %s status=%s duration=%dms',
                    relativeTestPath,
                    options.status,
                    options.duration
                  );
                  await harness.callHook('test-file:finished', {
                    runId,
                    file: relativeTestPath,
                    duration: options.duration,
                    status: options.status,
                    result: options.result,
                  });
                };

                try {
                  if (watcher.isInterrupted()) {
                    throw new CancelRun();
                  }

                  if (
                    harnessConfig.resetEnvironmentBetweenTestFiles &&
                    !isFirstTest
                  ) {
                    runLogger.debug(
                      'resetting environment before %s',
                      relativeTestPath
                    );
                    await harness.restart(test.path);
                  }
                  isFirstTest = false;

                  const result = await onStart(test).then(async () => {
                    if (!harnessConfig.detectNativeCrashes) {
                      runLogger.debug(
                        'native crash detection disabled for %s',
                        relativeTestPath
                      );
                      await harness.ensureAppReady(test.path);
                      return runHarnessTestFile({
                        testPath: test.path,
                        harness,
                        globalConfig: this.#globalConfig,
                        projectConfig: test.context.config,
                      });
                    }

                    await harness.ensureAppReady(test.path);
                    harness.crashSupervisor.beginTestRun(test.path);
                    runLogger.debug(
                      'native crash detection armed for %s',
                      relativeTestPath
                    );
                    const crashPromise =
                      harness.crashSupervisor.waitForCrash(test.path);

                    try {
                      return await Promise.race([
                        runHarnessTestFile({
                          testPath: test.path,
                          harness,
                          globalConfig: this.#globalConfig,
                          projectConfig: test.context.config,
                        }),
                        crashPromise,
                      ]);
                    } finally {
                      harness.crashSupervisor.cancelCrashWaiters();
                    }
                  });

                  applyJestResultToSummary(summary, result.jestResult);
                  didApplySummary = true;
                  updateRunState();
                  await emitTestFileFinished({
                    status: result.harnessResult.status,
                    duration: result.duration,
                    result: result.harnessResult,
                  });

                  return result;
                } catch (error) {
                  if (!didEmitTestFileFinished) {
                    await emitTestFileFinished({
                      status: 'failed',
                      duration: Date.now() - testFileStartedAt,
                      result: null,
                    });
                  }

                  throw error;
                }
              })
              .then(async (result) => {
                if (!result) {
                  return;
                }

                await onResult(test, result.jestResult);
              })
              .catch(async (err) => {
                if (
                  err instanceof NativeCrashError ||
                  err instanceof StartupStallError ||
                  err instanceof DeviceNotRespondingError
                ) {
                  runLogger.debug(
                    'classified runtime failure for %s: %s',
                    test.path,
                    err.name
                  );
                  summary.failed += 1;
                  updateRunState();
                }

                if (err instanceof NativeCrashError) {
                  harness.crashSupervisor.reset();
                  onFailure(test, {
                    message: err.message,
                    stack: '',
                  });

                  return;
                }

                if (err instanceof StartupStallError) {
                  onFailure(test, {
                    message: err.message,
                    stack: '',
                  });

                  return;
                }

                if (err instanceof DeviceNotRespondingError) {
                  onFailure(test, {
                    message: err.message,
                    stack: '',
                  });

                  return;
                }

                if (!(err instanceof CancelRun) && !didApplySummary) {
                  summary.failed += 1;
                }
                updateRunState({ error: err });
                onFailure(test, err);
              });
          }),
        Promise.resolve()
      );

      const runState = updateRunState();
      runLogger.debug(
        'run finished: runId=%s status=%s duration=%dms',
        runId,
        runState.status ?? 'passed',
        Date.now() - startTime
      );
      await harness.callHook('run:finished', {
        runId,
        startTime,
        duration: Date.now() - startTime,
        testFiles,
        summary,
        status: runState.status ?? 'passed',
      });
    } catch (error) {
      const runState = updateRunState({
        error,
        status: 'failed',
      });
      runLogger.debug(
        'run failed: runId=%s status=%s',
        runId,
        runState.status ?? 'failed'
      );
      await harness.callHook('run:finished', {
        runId,
        startTime,
        duration: Date.now() - startTime,
        testFiles,
        summary,
        status: runState.status ?? 'failed',
        error,
      });
      throw error;
    }
  }
}
