import { HARNESS_BRIDGE_PATH } from '@react-native-harness/bridge';
import { getDevServerUrl } from '../utils/dev-server.js';

export const getWSServer = (): string => {
  const devServerUrlString = getDevServerUrl();
  const devServerUrl = new globalThis.URL(devServerUrlString);

  if (!devServerUrl.host) {
    throw new TypeError(`Invalid URL: ${devServerUrlString}`);
  }

  const protocol = devServerUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${devServerUrl.host}${HARNESS_BRIDGE_PATH}`;
};
