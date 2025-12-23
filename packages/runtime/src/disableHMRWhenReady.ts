export function disableHMRWhenReady(
  disable: () => void,
  retriesLeft: number,
  schedule: (cb: () => void) => void = (cb) => setTimeout(cb, 0),
) {
  try {
    disable();
  } catch (error) {
    if (
      retriesLeft > 0 &&
      error instanceof Error &&
      error.message.includes('Expected HMRClient.setup() call at startup.')
    ) {
      schedule(() => disableHMRWhenReady(disable, retriesLeft - 1, schedule));
      return;
    }

    throw error;
  }
}
