/**
 * Lets a timer stop keeping the process alive. Node timers expose `unref()`;
 * consumers compiled against DOM typings see timers as numbers, so the call
 * is guarded instead of typed against `NodeJS.Timeout`.
 */
export const unrefTimer = (timer: unknown): void => {
  const candidate = timer as { unref?: () => unknown } | null | undefined;
  if (candidate && typeof candidate.unref === 'function') {
    candidate.unref();
  }
};
