import { tryGetHandle } from '../client/store.js';
import { MalformedModuleError } from './errors.js';

/**
 * Yield to the host so queued native calls (notably the `busy` bridge message)
 * are flushed before we block the JS thread. On React Native a `setTimeout`
 * boundary is what returns control to native and drains the message queue --
 * anything sent in the same tick as a blocking `eval()` would otherwise sit in
 * the queue until the `eval()` finishes, which is exactly what we are trying to
 * avoid.
 */
const flushPendingMessages = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * `evaluateModule`, wrapped so the harness knows the JS thread is about to be
 * blocked. Hermes parses the entire module bundle before running a single line
 * of it, and for large test graphs that parse can easily outlive the bridge
 * heartbeat timeout -- a run would then fail with "app heartbeat timed out"
 * without anything having actually crashed.
 */
export const evaluateModuleAsync = async (
  moduleJs: string,
  modulePath: string
): Promise<void> => {
  const handle = tryGetHandle();

  if (!handle) {
    evaluateModule(moduleJs, modulePath);
    return;
  }

  handle.setBusy(true, `evaluating ${modulePath}`);
  await flushPendingMessages();

  try {
    evaluateModule(moduleJs, modulePath);
  } finally {
    handle.setBusy(false);
  }
};

export const evaluateModule = (moduleJs: string, modulePath: string): void => {
  const __rMatches = Array.from(moduleJs.matchAll(/__r\((\d+)\)/g));

  if (__rMatches.length === 0) {
    throw new MalformedModuleError(modulePath, 'No __r function found');
  }

  // Get the last match as there may be many require calls
  const __rMatch = __rMatches[__rMatches.length - 1];
  const __rParam = __rMatch[1];

  if (!__rParam) {
    throw new MalformedModuleError(modulePath, 'No __r parameter found');
  }

  const moduleId = Number(__rParam);

  // This is important as if module was already initialized, it would not be re-initialized
  global.__resetModule(moduleId);

  // eslint-disable-next-line no-eval
  eval(moduleJs);
};
