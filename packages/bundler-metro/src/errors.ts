import { HarnessError } from '@react-native-harness/tools';

export class MetroPortUnavailableError extends HarnessError {
  constructor(public readonly port: number) {
    super(`Metro port ${port} is not available`);
    this.name = 'MetroPortUnavailableError';
  }
}

export class MetroBundlerNotReadyError extends HarnessError {
  constructor(public readonly maxRetries: number) {
    super(`Metro bundler is not ready after ${maxRetries} attempts`);
    this.name = 'MetroBundlerNotReadyError';
  }
}
