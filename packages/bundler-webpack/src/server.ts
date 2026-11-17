import http from 'node:http';
import type { BundlerWebSocketEndpoint } from '@react-native-harness/bundlers';
import { trackServerConnections } from '@react-native-harness/tools';
import { ServerStartError } from './errors.js';

export type HarnessServer = {
  server: http.Server;
  /** Stops listening and destroys every connection, upgraded ones included. */
  close: () => Promise<void>;
};

/**
 * Mounts each WebSocket server at its path on `server`: a request to upgrade
 * is handed to the server whose path it names, and refused otherwise.
 */
const mountWebSocketEndpoints = (
  server: http.Server,
  endpoints: Record<string, BundlerWebSocketEndpoint>
): void => {
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const endpoint = endpoints[pathname];

    if (!endpoint) {
      socket.destroy();
      return;
    }

    endpoint.handleUpgrade(request, socket, head, (client) => {
      endpoint.emit('connection', client, request);
    });
  });
};

export const startServer = async ({
  port,
  host,
  onRequest,
  websocketEndpoints,
}: {
  port: number;
  host?: string;
  onRequest: http.RequestListener;
  websocketEndpoints: Record<string, BundlerWebSocketEndpoint>;
}): Promise<HarnessServer> => {
  const server = http.createServer(onRequest);
  server.keepAliveTimeout = 30000;
  mountWebSocketEndpoints(server, websocketEndpoints);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  }).catch((error: unknown) => {
    throw new ServerStartError(port, error);
  });

  return { server, close: trackServerConnections(server).close };
};
