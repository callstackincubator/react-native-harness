import { type ChildProcess } from 'node:child_process';
import {
  getReactNativeCliPath,
  getExpoCliPath,
  getTimeoutSignal,
  spawn,
  SubprocessError,
  logger,
} from '@react-native-harness/tools';

const METRO_PORT = 8081;

export const runMetro = async (isExpo = false): Promise<ChildProcess> => {
  const metro = spawn(
    'node',
    [
      isExpo ? getExpoCliPath() : getReactNativeCliPath(),
      'start',
      '--port',
      METRO_PORT.toString(),
    ],
    {
      env: {
        ...process.env,
        RN_HARNESS: 'true',
        ...(isExpo && { EXPO_NO_METRO_WORKSPACE_ROOT: 'true' }),
      },
    }
  );

  // Forward metro output to logger
  metro.nodeChildProcess.then((childProcess) => {
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        logger.debug(data.toString().trim());
      });
    }
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        logger.debug(data.toString().trim());
      });
    }
  });

  metro.catch((error) => {
    // This process is going to be killed by us, so we don't need to throw an error
    if (error instanceof SubprocessError && error.signalName === 'SIGTERM') {
      return;
    }

    throw error;
  });

  await waitForMetro();
  return metro.nodeChildProcess;
};

export const waitForMetro = async (
  port = 8081,
  maxRetries = 20,
  retryDelay = 1000
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
    } catch {
      // Errors are expected here, we're just waiting for the process to be ready
    }

    if (attempts < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error(`Metro bundler is not ready after ${maxRetries} attempts`);
};

export const reloadApp = async (): Promise<void> => {
  await fetch(`http://localhost:${METRO_PORT}/reload`);
};
