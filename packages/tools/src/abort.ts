export const getTimeoutSignal = (timeout: number): AbortSignal => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeout);
  return controller.signal;
};
