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

export const getErrorMessage = (error: HarnessError): string => {
  return `${ERROR_TAG} ${error.message}\n`;
};
