import { HARNESS_BRIDGE_PATH } from '@react-native-harness/bridge';
import { getDevServerUrl } from '../utils/dev-server.js';

export const getWSServer = (): string => {
  const devServerUrl = new URL(getDevServerUrl());
  const protocol = devServerUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${devServerUrl.host}${HARNESS_BRIDGE_PATH}`;
};
