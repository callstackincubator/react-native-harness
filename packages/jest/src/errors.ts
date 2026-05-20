import { HarnessError } from '@react-native-harness/tools';
export {
  NativeCrashError,
  type NativeCrashDetails,
} from '@react-native-harness/platforms';
export {
  StartupStallError,
  type StartupStallCode,
  type StartupStallDetails,
} from '@react-native-harness/bundler-metro';

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

export class PlatformReadyTimeoutError extends HarnessError {
  constructor(public readonly timeout: number) {
    super(
      `The platform did not become ready within ${timeout}ms. Increase "platformReadyTimeout" if your device, simulator, or emulator needs more time to start.`
    );
    this.name = 'PlatformReadyTimeoutError';
  }
}

export class MetroPortRangeExhaustedError extends HarnessError {
  constructor(
    public readonly initialPort: number,
    public readonly attempts: number
  ) {
    const finalPort = initialPort + attempts - 1;
    super(
      `Harness could not find an available Metro port in the range ${initialPort}-${finalPort}.`
    );
    this.name = 'MetroPortRangeExhaustedError';
  }
}
