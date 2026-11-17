import { Platform } from 'react-native';

const HMR_SETUP_ERROR = 'Expected HMRClient.setup() call at startup.';

export function disableHMRWhenReady(
  disable: () => void,
  retriesLeft: number,
  retryDelay = 10,
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
        const isMissingHMRSetupError =
          error instanceof Error && error.message.includes(HMR_SETUP_ERROR);

        if (remaining > 0 && isMissingHMRSetupError) {
          setTimeout(() => attempt(remaining - 1), retryDelay);
          return;
        }

        // Expo's metro runtime does not guarantee that React Native's HMRClient
        // is initialized, so disabling HMR is best-effort in that environment.
        if (isMissingHMRSetupError) {
          resolve();
          return;
        }

        reject(error);
      }
    }

    attempt(retriesLeft);
  });
}
