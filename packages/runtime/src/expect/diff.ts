import { processError } from '@vitest/utils/error';

const readDiff = (error: { diff?: unknown }): string | undefined =>
  typeof error.diff === 'string' && error.diff ? error.diff : undefined;

// Vitest computes the expected/received diff in its test runner, so
// @vitest/expect only does it for soft assertions. Thrown assertion errors
// get the same treatment here.
export const getErrorDiff = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  // Already processed, e.g. a soft assertion error.
  if ('diff' in error) {
    return readDiff(error);
  }

  try {
    return readDiff(processError(error));
  } catch {
    return undefined;
  }
};
