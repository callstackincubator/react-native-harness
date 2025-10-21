import { TestRunnerConfig } from '@react-native-harness/config';
import chalk from 'chalk';

const TAG = chalk.supportsColor
  ? chalk.reset.inverse.bold.magenta(` HARNESS `)
  : 'HARNESS';

// @see https://github.com/jestjs/jest/blob/main/packages/jest-reporters/src/BaseReporter.ts#L25
export const log = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

export const logTestRunHeader = (runner: TestRunnerConfig): void => {
  log(
    `${TAG} Preparing to run tests using ${chalk.bold(runner.name)} runner\n`
  );
};

export const logTestEnvironmentReady = (runner: TestRunnerConfig): void => {
  log(`${TAG} Runner ${chalk.bold(runner.name)} ready\n`);
};
