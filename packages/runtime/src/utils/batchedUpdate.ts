import { unstable_batchedUpdates } from 'react-native';

/**
 * Batches state updates to avoid act() warnings in React Native.
 * Falls back to direct execution if unstable_batchedUpdates is unavailable.
 */
export const batchedUpdate = (fn: () => void): void => {
  if (unstable_batchedUpdates) {
    unstable_batchedUpdates(fn);
  } else {
    fn();
  }
};
