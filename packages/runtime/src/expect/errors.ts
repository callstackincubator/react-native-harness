import type { HarnessExpectTestState } from './context.js';
import { getErrorDiff } from './diff.js';

type SerializedExpectError = {
  name?: string;
  message?: string;
  stack?: string;
};

const formatErrorTitle = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (error && typeof error === 'object') {
    const maybeError = error as { name?: string; message?: string };
    if (maybeError.name || maybeError.message) {
      return [maybeError.name, maybeError.message].filter(Boolean).join(': ');
    }
  }

  return String(error);
};

// The flattened error has no actual/expected of its own, so each failure
// keeps its diff next to its message.
const formatErrorMessage = (error: unknown): string => {
  const title = formatErrorTitle(error);
  const diff = getErrorDiff(error);

  return diff ? `${title}\n\n${diff}` : title;
};

const createExpectError = (errors: unknown[], title?: string): Error => {
  const message = [title, ...errors.map(formatErrorMessage)]
    .filter(Boolean)
    .join('\n\n');

  const error = new Error(message);
  const firstError = errors.find(
    (value): value is SerializedExpectError =>
      !!value && typeof value === 'object',
  );

  if (firstError?.name) {
    error.name = firstError.name;
  }

  if (firstError?.stack) {
    error.stack = firstError.stack.replace(
      /^([^\n]+)(\n|$)/,
      `${error.name}: ${message}$2`,
    );
  }

  return error;
};

export const flushExpectTestState = async (
  state: HarnessExpectTestState,
): Promise<void> => {
  if (state.promises?.length) {
    const results = await Promise.allSettled(state.promises);
    const rejected = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )
      .map((result) => result.reason);

    if (rejected.length > 0) {
      throw createExpectError(rejected);
    }
  }

  for (const hook of state.onFinished ?? []) {
    await hook();
  }

  const softErrors = state.result?.errors ?? [];
  if (softErrors.length === 0) {
    return;
  }

  throw createExpectError(softErrors, 'Soft assertion failures:');
};
