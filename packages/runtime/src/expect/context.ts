type HarnessExpectError = {
  name?: string;
  message?: string;
  stack?: string;
};

export type HarnessExpectTestState = {
  result?: {
    state: 'pass' | 'fail';
    errors?: HarnessExpectError[];
  };
  promises?: Promise<unknown>[];
  onFinished?: Array<() => void | Promise<void>>;
};

declare global {
  var HARNESS_EXPECT_TEST_STATE: HarnessExpectTestState | undefined;
}

export const getCurrentExpectTestState = ():
  | HarnessExpectTestState
  | undefined => {
  return globalThis.HARNESS_EXPECT_TEST_STATE;
};

export const setCurrentExpectTestState = (
  state: HarnessExpectTestState | undefined,
): void => {
  globalThis.HARNESS_EXPECT_TEST_STATE = state;
};
