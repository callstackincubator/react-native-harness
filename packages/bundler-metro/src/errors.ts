import { HarnessError } from '@react-native-harness/tools';

export class MetroPortUnavailableError extends HarnessError {
  constructor(public readonly port: number) {
    super(`Metro port ${port} is not available`);
    this.name = 'MetroPortUnavailableError';
  }
}

export class MetroNotInstalledError extends HarnessError {
  constructor() {
    super(
      'Metro was not found in your project. This is unexpected. Please report this issue to the React Native Harness team.'
    );
    this.name = 'MetroNotInstalledError';
  }
}
