import type { HarnessExpectTestState } from './context.js';

type SerializedExpectError = {
  name?: string;
  message?: string;
  stack?: string;
};

const formatErrorMessage = (error: unknown): string => {
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
