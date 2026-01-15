export type HarnessContext = {
  testFilePath: string;
  runner: string;
};

declare global {
  var HARNESS_CONTEXT: HarnessContext;
}

export const getHarnessContext = (): HarnessContext => {
  return globalThis['HARNESS_CONTEXT'];
};

export const setHarnessContext = (context: HarnessContext): void => {
  globalThis['HARNESS_CONTEXT'] = context;
};
