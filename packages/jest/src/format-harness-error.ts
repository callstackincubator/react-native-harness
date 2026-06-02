import type { SerializedError } from '@react-native-harness/bridge';

const formatPendingPromiseStack = (stack: string): string =>
  stack
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

const formatPendingPromises = (
  pendingPromises: NonNullable<
    NonNullable<SerializedError['diagnostics']>['pendingPromises']
  >,
  testStartedAt?: number,
): string | null => {
  if (pendingPromises.total === 0) {
    return null;
  }

  const lines = [`Pending promises at timeout: ${pendingPromises.total}`];

  if (pendingPromises.items.length < pendingPromises.total) {
    lines.push(
      `Showing ${pendingPromises.items.length} of ${pendingPromises.total} pending promises.`,
    );
  }

  for (const promise of pendingPromises.items) {
    const age =
      testStartedAt !== undefined
        ? `, created ${Math.max(0, promise.createdAt - testStartedAt)}ms after test start`
        : '';

    lines.push('');
    lines.push(`Promise #${promise.id}${age}:`);

    if (promise.stack) {
      lines.push(formatPendingPromiseStack(promise.stack));
    } else {
      lines.push('  <stack unavailable>');
    }
  }

  return lines.join('\n');
};

export const formatHarnessErrorMessage = (
  error: SerializedError | undefined,
  options: {
    testStartedAt?: number;
  } = {},
): string | undefined => {
  if (!error) {
    return undefined;
  }

  const parts = [error.message];
  const pendingPromiseDetails = error.diagnostics?.pendingPromises
    ? formatPendingPromises(
        error.diagnostics.pendingPromises,
        options.testStartedAt,
      )
    : null;

  if (pendingPromiseDetails) {
    parts.push(pendingPromiseDetails);
  }

  if (error.codeFrame) {
    parts.push(error.codeFrame.content);
  }

  return parts.join('\n\n');
};
