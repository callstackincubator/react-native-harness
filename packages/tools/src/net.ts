import net from 'node:net';

export const getAvailablePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });

    server.on('error', reject);
  });
