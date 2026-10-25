import { HARNESS_BRIDGE_PATH } from '@react-native-harness/bridge';
import { getDevServerUrl } from '../utils/dev-server.js';

// Scheme, optional user info, and host (with port) of an absolute URL. Parsed
// by hand because URL polyfills for React Native read the legacy
// NativeModules bridge, which bridgeless runtimes such as Vega do not have.
const ABSOLUTE_URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?([^/?#]+)/i;

export const getWSServer = (): string => {
  const devServerUrl = getDevServerUrl();
  const match = devServerUrl.match(ABSOLUTE_URL_PATTERN);

  if (!match) {
    throw new TypeError(`Invalid URL: ${devServerUrl}`);
  }

  const [, scheme, host] = match;
  const protocol = scheme.toLowerCase() === 'https' ? 'wss:' : 'ws:';

  return `${protocol}//${host.toLowerCase()}${HARNESS_BRIDGE_PATH}`;
};
