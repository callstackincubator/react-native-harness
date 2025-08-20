import { getDevServerUrl } from '../utils/dev-server.js';
import { WS_SERVER_PORT } from '../constants.js';

export const getWSServer = (): string => {
  const devServerUrl = getDevServerUrl();
  const hostname = devServerUrl.split('://')[1].split(':')[0];

  return `ws://${hostname}:${WS_SERVER_PORT}`;
};
