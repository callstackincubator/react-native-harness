import type { HarnessHandle } from '@react-native-harness/bridge/client';

let handle: HarnessHandle | null = null;

export const setHandle = (h: HarnessHandle): void => {
  handle = h;
};

export const getHandle = (): HarnessHandle => {
  if (!handle) {
    throw new Error(
      'Harness not connected. This should not happen in normal operation.'
    );
  }
  return handle;
};
