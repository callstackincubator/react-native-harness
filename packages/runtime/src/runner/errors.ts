import type { SerializedError } from '@react-native-harness/bridge';

export class TestExecutionError extends Error {
  file: string;
  suite: string;
  test: string;

  constructor(error: unknown, file: string, suite: string, test: string) {
    super('Test execution error');
    this.name = 'TestExecutionError';
    this.file = file;
    this.suite = suite;
    this.test = test;
    this.cause = error;
  }

  toSerializedJSON(): SerializedError {
    const causeName =
      this.cause instanceof Error ? this.cause.name : 'Unknown name';
    const causeMessage =
      this.cause instanceof Error ? this.cause.message : 'Unknown message';
    const causeStack =
      this.cause instanceof Error ? this.cause.stack : undefined;

    return {
      name: causeName,
      message: causeMessage,
      stack: causeStack,
    };
  }
}
