import type { SerializedError, CodeFrame } from '@react-native-harness/bridge';
import { getCodeFrame } from '../symbolicate.js';

export class TestExecutionError extends Error {
  file: string;
  suite: string;
  test: string;
  codeFrame?: CodeFrame;

  constructor(
    error: unknown,
    file: string,
    suite: string,
    test: string,
    codeFrame?: CodeFrame
  ) {
    super('Test execution error');
    this.name = 'TestExecutionError';
    this.file = file;
    this.suite = suite;
    this.test = test;
    this.cause = error;
    this.codeFrame = codeFrame;
  }

  toSerializedJSON(): SerializedError {
    const causeName =
      this.cause instanceof Error ? this.cause.name : 'Unknown name';
    const causeMessage =
      this.cause instanceof Error ? this.cause.message : 'Unknown message';
    const causeCodeFrame = this.codeFrame;

    return {
      name: causeName,
      message: causeMessage,
      codeFrame: causeCodeFrame,
    };
  }
}

export const getTestExecutionError = async (
  error: unknown,
  file: string,
  suite: string,
  test: string
): Promise<TestExecutionError> => {
  try {
    if (error instanceof Error) {
      const codeFrame = await getCodeFrame(error);

      if (codeFrame) {
        return new TestExecutionError(error, file, suite, test, codeFrame);
      }
    }

    return new TestExecutionError(error, file, suite, test);
  } catch (error) {
    // If the stack cannot be symbolicated, return the original error
    return new TestExecutionError(error, file, suite, test);
  }
};
