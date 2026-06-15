export const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

export const waitForAbort = (signal: AbortSignal): Promise<never> => {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? createAbortError());
  }

  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason ?? createAbortError());
      },
      { once: true }
    );
  });
};

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
