import { BridgeClient } from '@react-native-harness/bridge/client';
import { state } from '../state.js';

export const getClient = (): BridgeClient => {
  const client = state.getState().client;

  if (!client) {
    throw new Error(
      'Client not found. Are you sure you are running the test in the react-native-harness environment?'
    );
  }

  return client;
};
