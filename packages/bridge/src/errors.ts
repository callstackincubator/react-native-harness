import { HarnessError } from '@react-native-harness/tools';

export class DeviceNotRespondingError extends HarnessError {
  constructor(
    public readonly functionName: string,
    public readonly args: unknown[]
  ) {
    super('The device did not respond within the timeout period.');
    this.name = 'DeviceNotRespondingError';
  }
}
