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
import { createHarnessSession, type HarnessSession } from './harness-session.js';
import { executeRun } from './execute-run.js';
import { HarnessError } from '@react-native-harness/tools';
import { getErrorMessage } from './logs.js';

export default class JestHarness implements CallbackTestRunnerInterface {
  readonly isSerial = true;

  #globalConfig: Config.GlobalConfig;
  #session: HarnessSession | null = null;

  constructor(globalConfig: Config.GlobalConfig) {
    this.#globalConfig = globalConfig;
  }

  async runTests(
    tests: Array<Test>,
    watcher: TestWatcher,
    onStart: OnTestStart,
    onResult: OnTestSuccess,
    onFailure: OnTestFailure,
    options: TestRunnerOptions,
  ): Promise<void> {
    if (!options.serial) {
      throw new Error('Parallel test running is not supported');
    }

    const isWatchMode = this.#globalConfig.watch || this.#globalConfig.watchAll;

    try {
      if (!this.#session) {
        this.#session = await createHarnessSession(this.#globalConfig);
      }

      await executeRun(
        this.#session,
        tests,
        watcher,
        onStart,
        onResult,
        onFailure,
        this.#globalConfig,
      );
    } catch (error) {
      if (error instanceof HarnessError) {
        throw getErrorMessage(error);
      }
      throw error;
    } finally {
      if (!isWatchMode) {
        await this.#session?.dispose();
        this.#session = null;
      }
    }
  }
}
