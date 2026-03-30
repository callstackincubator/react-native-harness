const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

export const getTimeoutSignal = (timeout: number): AbortSignal => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(createAbortError()), timeout);

  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timeoutId);
    },
    { once: true }
  );

  return controller.signal;
};

export const raceAbortSignals = (signals: AbortSignal[]): AbortSignal => {
  const controller = new AbortController();

  if (signals.length === 0) {
    return controller.signal;
  }

  const cleanupCallbacks: Array<() => void> = [];

  const cleanup = () => {
    while (cleanupCallbacks.length > 0) {
      cleanupCallbacks.pop()?.();
    }
  };

  const abortWithSignal = (signal: AbortSignal) => {
    cleanup();
    controller.abort(signal.reason ?? createAbortError());
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abortWithSignal(signal);
      return controller.signal;
    }

    const onAbort = () => abortWithSignal(signal);
    signal.addEventListener('abort', onAbort, { once: true });
    cleanupCallbacks.push(() => signal.removeEventListener('abort', onAbort));
  }

  controller.signal.addEventListener('abort', cleanup, { once: true });

  return controller.signal;
};

export const withAbortTimeout = (
  signal: AbortSignal,
  timeout: number
): AbortSignal => {
  return raceAbortSignals([signal, getTimeoutSignal(timeout)]);
};
