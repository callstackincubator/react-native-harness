import { Platform } from "react-native";

export function disableHMRWhenReady(
  disable: () => void,
  retriesLeft: number,
  retryDelay = 10
) {
  return new Promise<void>((resolve, reject) => {
    if (Platform.OS === 'web') {
      // No HMR on web
      resolve();
      return;
    }

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
          setTimeout(() => attempt(remaining - 1), retryDelay);
          return;
        }

        reject(error);
      }
    }

    attempt(retriesLeft);
  });
}
