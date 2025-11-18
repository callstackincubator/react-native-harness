import net from 'node:net';
import { createRequire } from 'node:module';
import { MetroNotInstalledError } from './errors.js';

const require = createRequire(import.meta.url);

export const isPortAvailable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      server.close();
      resolve(false);
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
};

export const getMetroPackage = (
  projectRoot: string
): typeof import('metro') => {
  try {
    const metroPath = require.resolve('metro', { paths: [projectRoot] });
    return require(metroPath);
  } catch {
    throw new MetroNotInstalledError();
  }
};

export type NotReadOnly<T> = {
  -readonly [K in keyof T]: T[K];
};
