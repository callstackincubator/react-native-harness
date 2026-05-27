import type {
  Config,
  EmittingTestRunnerInterface,
  Test,
  TestEvents,
  TestRunnerOptions,
  TestWatcher,
} from 'jest-runner';
import { createHarnessSession, type HarnessSession } from './harness-session.js';
import { executeRun } from './execute-run.js';
import { HarnessError } from '@react-native-harness/tools';
import { getErrorMessage } from './logs.js';

type TestEventListener<Name extends keyof TestEvents> = (
  eventData: TestEvents[Name],
) => void | Promise<void>;

export default class JestHarness implements EmittingTestRunnerInterface {
  readonly isSerial = true;
  readonly supportsEventEmitters = true as const;

  #globalConfig: Config.GlobalConfig;
  #session: HarnessSession | null = null;
  #listeners = new Map<keyof TestEvents, Set<TestEventListener<keyof TestEvents>>>();

  constructor(globalConfig: Config.GlobalConfig) {
    this.#globalConfig = globalConfig;
  }

  on<Name extends keyof TestEvents>(
    eventName: Name,
    listener: TestEventListener<Name>,
  ): () => void {
    const listeners = this.#listeners.get(eventName) ?? new Set();
    listeners.add(listener as TestEventListener<keyof TestEvents>);
    this.#listeners.set(eventName, listeners);

    return () => {
      listeners.delete(listener as TestEventListener<keyof TestEvents>);
      if (listeners.size === 0) {
        this.#listeners.delete(eventName);
      }
    };
  }

  async runTests(
    tests: Array<Test>,
    watcher: TestWatcher,
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
        this.#emit,
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

  #emit = async <Name extends keyof TestEvents>(
    eventName: Name,
    ...eventData: TestEvents[Name]
  ): Promise<void> => {
    const listeners = this.#listeners.get(eventName);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      await listener(eventData);
    }
  };
}
