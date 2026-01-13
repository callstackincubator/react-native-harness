import { HarnessError } from '@react-native-harness/tools';

export class NoRunnerSpecifiedError extends HarnessError {
  constructor() {
    super('No runner specified');
    this.name = 'NoRunnerSpecifiedError';
  }
}

export class RunnerNotFoundError extends HarnessError {
  constructor(public readonly runnerName: string) {
    super(`Runner "${runnerName}" not found`);
    this.name = 'RunnerNotFoundError';
  }
}

export class InitializationTimeoutError extends HarnessError {
  constructor() {
    super('The Harness did not become ready within the timeout period.');
    this.name = 'InitializationTimeoutError';
  }
}

export class MaxAppRestartsError extends HarnessError {
  constructor(attempts: number) {
    super(
      `App failed to start after ${attempts} attempts. ` +
        `No bundling activity detected within timeout period.`
    );
    this.name = 'MaxAppRestartsError';
  }
}

export class NativeCrashError extends HarnessError {
  constructor(
    public readonly testFilePath: string,
    public readonly lastKnownTest?: string
  ) {
    super('The native app crashed during test execution.');
    this.name = 'NativeCrashError';
  }
}
