import type { HarnessExpectTestState } from './context.js';

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
      throw new Error(rejected.map(formatErrorMessage).join('\n\n'));
    }
  }

  for (const hook of state.onFinished ?? []) {
    await hook();
  }

  const softErrors = state.result?.errors ?? [];
  if (softErrors.length === 0) {
    return;
  }

  throw new Error(
    ['Soft assertion failures:', ...softErrors.map(formatErrorMessage)].join(
      '\n\n',
    ),
  );
};
