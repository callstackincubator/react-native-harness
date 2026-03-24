let hasWarned = false;

export const withRnHarness = <T>(
  config: T | Promise<T>,
  _isInvokedByHarness = false
): (() => Promise<T>) => {
  return async () => {
    if (!hasWarned) {
      hasWarned = true;
      console.warn(
        "[react-native-harness] `withRnHarness` in Metro configs is deprecated and will be removed in a future release. Remove `withRnHarness` from your Metro config; React Native Harness now patches Metro internally."
      );
    }

    return await config;
  };
};
