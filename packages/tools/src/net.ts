import net, { type Socket } from 'node:net';

export const getAvailablePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });

    server.on('error', reject);
  });

/**
 * Tracks the sockets of an HTTP server and returns a `close` that stops it
 * and destroys every connection. `closeAllConnections()` does not close
 * sockets upgraded to WebSockets, and those keep `server.close()` from ever
 * calling back, so they are destroyed here.
 */
export const trackServerConnections = (server: {
  on: (event: 'connection', listener: (socket: Socket) => void) => unknown;
  close: (callback: () => void) => unknown;
  closeAllConnections: () => void;
}): { close: () => Promise<void> } => {
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        for (const socket of sockets) {
          socket.destroy();
        }
      }),
  };
};
