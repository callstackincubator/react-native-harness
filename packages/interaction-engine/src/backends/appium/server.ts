import { spawn } from '@react-native-harness/tools';
import * as net from 'node:net';

export type RunAppiumServerOptions = {
  port: number;
  timeout?: number;
};

export const runAppiumServer = async (options: RunAppiumServerOptions) => {
  spawn('appium', ['--port', options.port.toString()], {
    ignoreErrors: true,
  });

  await waitForServer({
    port: options.port,
    timeout: options.timeout || 30000,
  });
};

const waitForServer = async ({
  port,
  timeout,
}: {
  port: number;
  timeout: number;
}): Promise<void> => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await checkConnection(port);
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(
    `Timed out waiting for Appium server to be ready on port ${port}`
  );
};

const checkConnection = (port: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    const onError = () => {
      socket.destroy();
      reject(new Error(`Cannot connect to port ${port}`));
    };

    socket.once('error', onError);

    socket.connect(port, 'localhost', () => {
      socket.end();
      resolve();
    });

    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error(`Connection to port ${port} timed out`));
    });
  });
};
