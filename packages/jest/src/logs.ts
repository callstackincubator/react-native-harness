import { HarnessPlatform } from '@react-native-harness/platforms';
import { HarnessError } from '@react-native-harness/tools';
import chalk from 'chalk';

const TAG = chalk.supportsColor
  ? chalk.reset.inverse.bold.magenta(` HARNESS `)
  : 'HARNESS';

const ERROR_TAG = chalk.supportsColor
  ? chalk.reset.inverse.bold.red(` HARNESS `)
  : 'HARNESS';

// @see https://github.com/jestjs/jest/blob/main/packages/jest-reporters/src/BaseReporter.ts#L25
export const log = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

export const logTestRunHeader = (runner: HarnessPlatform): void => {
  log(
    `${TAG} Preparing to run tests using ${chalk.bold(runner.name)} runner\n`
  );
};

export const logTestEnvironmentReady = (runner: HarnessPlatform): void => {
  log(`${TAG} Runner ${chalk.bold(runner.name)} ready\n`);
};

export const logRunnerWaitingInQueue = (runner: HarnessPlatform): void => {
  log(`${TAG} Runner ${chalk.bold(runner.name)} is busy, waiting in queue\n`);
};

export const logRunnerStillWaitingInQueue = (runner: HarnessPlatform): void => {
  log(`${TAG} Still waiting in queue for ${chalk.bold(runner.name)} runner\n`);
};

export const logRunnerStarting = (runner: HarnessPlatform): void => {
  log(`${TAG} Runner ${chalk.bold(runner.name)} is starting\n`);
};

export const logMetroPrewarmCompleted = (runner: HarnessPlatform): void => {
  log(`${TAG} Metro pre-warm for ${chalk.bold(runner.name)} completed\n`);
};

export const logMetroCacheReused = (runner: HarnessPlatform): void => {
  log(`${TAG} Reusing Metro cache for ${chalk.bold(runner.name)}\n`);
};

export const getErrorMessage = (error: HarnessError): string => {
  return `${ERROR_TAG} ${error.message}\n`;
};
