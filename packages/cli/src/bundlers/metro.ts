import { type ChildProcess } from 'node:child_process';
import { getTimeoutSignal, spawn } from '@react-native-harness/tools';

export const runMetro = async (): Promise<ChildProcess> => {
  const metro = spawn('react-native', ['start'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      RN_HARNESS: 'true',
    },
    ignoreErrors: true,
  });
  const nodeChildProcess = await metro.nodeChildProcess;

  await waitForMetro();
  return nodeChildProcess;
};

export const waitForMetro = async (
  port: number = 8081,
  maxRetries: number = 10,
  retryDelay: number = 1000
): Promise<void> => {
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;

    try {
      const response = await fetch(`http://localhost:${port}/status`, {
        signal: getTimeoutSignal(100),
      });

      if (response.ok) {
        const body = await response.text();

        if (body === 'packager-status:running') {
          return;
        }
      }
    } catch {}

    if (attempts < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error(`Metro bundler is not ready after ${maxRetries} attempts`);
};

export const reloadApp = async (port: number = 8081): Promise<void> => {
  await fetch(`http://localhost:${port}/reload`);
};
