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
