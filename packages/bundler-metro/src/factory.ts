import {
  getReactNativeCliPath,
  getExpoCliPath,
  getTimeoutSignal,
  spawn,
  logger,
  SubprocessError,
} from '@react-native-harness/tools';
import { isPortAvailable } from './utils.js';
import {
  MetroPortUnavailableError,
  MetroBundlerNotReadyError,
} from './errors.js';
import { METRO_PORT } from './constants.js';
import type { MetroInstance } from './types.js';

const waitForMetro = async (
  port: number,
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

  throw new MetroBundlerNotReadyError(maxRetries);
};

export const getMetroInstance = async (
  isExpo = false
): Promise<MetroInstance> => {
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

    logger.error('Metro crashed unexpectedly', error);
  });

  const isDefaultPortAvailable = await isPortAvailable(METRO_PORT);

  if (!isDefaultPortAvailable) {
    throw new MetroPortUnavailableError(METRO_PORT);
  }

  await waitForMetro(METRO_PORT);
  const childProcess = await metro.nodeChildProcess;

  return {
    dispose: async () => {
      const isKilled = childProcess.kill('SIGTERM');

      if (!isKilled) {
        childProcess.kill('SIGKILL');
      }
    },
  };
};
