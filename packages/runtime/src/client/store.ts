import type { BridgeClient } from '@react-native-harness/bridge/client';

let clientInstance: BridgeClient | null = null;

export const setClient = (client: BridgeClient): void => {
  clientInstance = client;
};

export const getClientInstance = (): BridgeClient => {
  if (!clientInstance) {
    throw new Error(
      'Bridge client not initialized. This should not happen in normal operation.'
    );
  }
  return clientInstance;
};
