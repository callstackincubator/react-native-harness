export function disableHMRWhenReady(
  disable: () => void,
  retriesLeft: number,
  schedule: (cb: () => void) => void = (cb) => setTimeout(cb, 0),
) {
  return new Promise<void>((resolve, reject) => {
    function attempt(remaining: number) {
      try {
        disable();
        resolve();
      } catch (error) {
        if (
          remaining > 0 &&
          error instanceof Error &&
          error.message.includes('Expected HMRClient.setup() call at startup.')
        ) {
          schedule(() => attempt(remaining - 1));
          return;
        }

        reject(error);
      }
    }

    attempt(retriesLeft);
  });
}
