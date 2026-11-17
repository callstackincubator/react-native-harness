export type StackFrame = {
  column: number | null | undefined;
  file: string | null | undefined;
  lineNumber: number | null | undefined;
  methodName: string;
};

/**
 * Everything that knows what environment the JS runs in. Installed by the
 * entry module the bundler swaps in.
 */
export type Host = {
  getDevServerUrl: () => string;
  reloadRuntime: () => void;
  parseErrorStack: (stack?: string) => StackFrame[];
  // Turns off dev overlays and hot reloading's client, and makes fatal errors
  // throw. Synchronous; runs when `initialize.ts` is evaluated.
  prepare: () => void;
  disableHMR: () => Promise<void>;
};

let installed: Host | undefined;

export const installHost = (host: Host): void => {
  installed = host;
};

export const getHost = (): Host => {
  if (!installed) {
    throw new Error(
      'No host is installed. The Harness entry module for your bundler must run before any other Harness code.'
    );
  }

  return installed;
};
