import { TestError } from './errors.js';
import { TestFn } from './types.js';

export const validateTestName = (name: string, functionName: string): void => {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new TestError('INVALID_TEST_NAME', functionName, {
      name,
    });
  }
};

export const validateTestFunction = (
  fn: TestFn,
  functionName: string
): void => {
  if (typeof fn !== 'function') {
    throw new TestError('INVALID_FUNCTION', functionName, {
      functionType: typeof fn,
    });
  }
};
