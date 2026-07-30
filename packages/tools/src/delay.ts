export type CancellableDelay = {
  promise: Promise<void>;
  cancel: () => void;
};

/**
 * Returns a promise that resolves after `ms`, plus a `cancel()` that clears
 * the underlying timer.
 *
 * Use this instead of a bare `setTimeout`-backed promise whenever the delay
 * competes in a `Promise.race`: if the delay loses the race, calling
 * `cancel()` (typically in a `finally`) clears the timer immediately instead
 * of leaving a ref'd `Timeout` alive in the event loop until it eventually
 * fires, which otherwise keeps the process from exiting.
 */
export const delay = (ms: number): CancellableDelay => {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
};
