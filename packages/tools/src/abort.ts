export const getTimeoutSignal = (timeout: number): AbortSignal => {
  return AbortSignal.timeout(timeout);
};

export const raceAbortSignals = (signals: AbortSignal[]): AbortSignal => {
  if (signals.length === 0) {
    return new AbortController().signal;
  }
  return AbortSignal.any(signals);
};

export const withAbortTimeout = (
  signal: AbortSignal,
  timeout: number
): AbortSignal => {
  return raceAbortSignals([signal, getTimeoutSignal(timeout)]);
};

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

const noop = () => undefined;

export type AbortWait = {
  /** Rejects with the signal's abort reason once `signal` aborts. */
  promise: Promise<never>;
  /**
   * Removes the underlying 'abort' listener without settling `promise`.
   * Call this (typically in a `finally`) when `signal` is a long-lived,
   * session-lifetime signal and this wait lost a `Promise.race` — otherwise
   * the listener (and everything it closes over) stays attached for the
   * remaining lifetime of `signal`, leaking one listener per call.
   */
  cancel: () => void;
};

/**
 * Self-cleaning counterpart to racing a bare `signal.addEventListener`
 * against other work: returns both the rejecting promise and a `cancel()`
 * to detach the listener when this side loses the race.
 */
export const waitForAbort = (signal: AbortSignal): AbortWait => {
  if (signal.aborted) {
    const promise = Promise.reject(signal.reason ?? createAbortError());
    // A caller may legitimately construct this, decide it no longer needs
    // to wait, and call cancel() without ever awaiting or racing `promise`
    // (cancel() can't retroactively un-reject it, unlike the pending-signal
    // path below). Attach a no-op handler so that case doesn't surface as
    // an unhandled rejection; callers that do consume `promise` still see
    // the real rejection normally.
    promise.catch(noop);

    return { promise, cancel: noop };
  }

  let reject!: (reason?: unknown) => void;
  const onAbort = () => reject(signal.reason ?? createAbortError());
  const promise = new Promise<never>((_, rejectFn) => {
    reject = rejectFn;
    signal.addEventListener('abort', onAbort, { once: true });
  });

  return {
    promise,
    cancel: () => signal.removeEventListener('abort', onAbort),
  };
};
