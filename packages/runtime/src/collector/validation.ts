import { TestError } from './errors.js';
import { TestFn, SuiteHookFn } from './types.js';

export const validateTestName = (name: string, functionName: string): void => {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new TestError('INVALID_TEST_NAME', functionName, {
      name,
    });
  }
};

export const validateTestFunction = (
  fn: TestFn | SuiteHookFn,
  functionName: string
): void => {
  if (typeof fn !== 'function') {
    throw new TestError('INVALID_FUNCTION', functionName, {
      functionType: typeof fn,
    });
  }
};
