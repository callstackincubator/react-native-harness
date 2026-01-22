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
import chalk from 'chalk';
import { runHarnessTestFile } from './run.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import { type Harness } from './harness.js';
import { setup } from './setup.js';
import { teardown } from './teardown.js';
import { HarnessError } from '@react-native-harness/tools';
import { getErrorMessage } from './logs.js';
import { DeviceNotRespondingError } from '@react-native-harness/bridge/server';
import { NativeCrashError } from './errors.js';
import { ConsoleEvent } from '@react-native-harness/bridge';

// Printf-style string interpolation for console messages
const formatConsoleMessage = (args: string[]): string => {
  if (!args || args.length === 0) return '';
  if (args.length === 1) return args[0];

  let template = String(args[0]);
  let argIndex = 1;

  // Replace %s, %d, %i, %o, %O, %j with corresponding arguments
  template = template.replace(/%[sdioOj]/g, (match) => {
    if (argIndex >= args.length) return match;
    const arg = args[argIndex++];
    switch (match) {
      case '%s':
        return String(arg);
      case '%d':
        return String(Number(arg));
      case '%i':
        return String(parseInt(String(arg), 10));
      case '%o':
      case '%O':
      case '%j':
        return typeof arg === 'string' ? arg : JSON.stringify(arg);
      default:
        return String(arg);
    }
  });

  // Append remaining arguments
  const remaining = args.slice(argIndex);
  if (remaining.length > 0) {
    template += ' ' + remaining.join(' ');
  }

  return template;
};

// Console event handler - prints console messages from device
const createConsoleEventHandler = (): ((event: ConsoleEvent) => void) => {
  return (event: ConsoleEvent) => {
    if (event.type === 'console') {
      const message = formatConsoleMessage(event.args);
      const tags: Record<string, string> = {
        log: chalk.supportsColor
          ? chalk.reset.inverse.bold.cyan(' LOG ')
          : 'LOG',
        warn: chalk.supportsColor
          ? chalk.reset.inverse.bold.yellow(' WARN ')
          : 'WARN',
        error: chalk.supportsColor
          ? chalk.reset.inverse.bold.red(' ERROR ')
          : 'ERROR',
        info: chalk.supportsColor
          ? chalk.reset.inverse.bold.blue(' INFO ')
          : 'INFO',
        debug: chalk.supportsColor
          ? chalk.reset.inverse.bold.gray(' DEBUG ')
          : 'DEBUG',
      };
      const tag = tags[event.level] || tags.log;
      process.stderr.write(`${tag} ${message}\n`);
    }
  };
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

    let consoleHandler: ((event: ConsoleEvent) => void) | null = null;

    try {
      // This is necessary as Harness may throw and we want to catch it and display a helpful error message.
      await setup(this.#globalConfig);

      const harness = global.HARNESS;
      const harnessConfig = global.HARNESS_CONFIG;

      // Setup console forwarding if not in silent mode
      if (!this.#globalConfig.silent) {
        consoleHandler = createConsoleEventHandler();
        harness.on('event', consoleHandler);
      }

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
      // Cleanup console handler
      if (consoleHandler && global.HARNESS) {
        global.HARNESS.off('event', consoleHandler);
      }
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
