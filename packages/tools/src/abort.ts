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
