import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { trackServerConnections } from '../net.js';

describe('trackServerConnections', () => {
  it('closes a server that holds a keep-alive connection and an upgraded socket', async () => {
    const server = http.createServer((_, response) => response.end('ok'));
    const upgraded = new Promise<void>((resolve) => {
      server.on('upgrade', (_request, socket) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n');
        resolve();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const { close } = trackServerConnections(server);

    const request = http.request({
      port,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
    });
    request.on('upgrade', () => undefined);
    request.on('error', () => undefined);
    request.end();
    await upgraded;

    await expect(close()).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
  });
});
