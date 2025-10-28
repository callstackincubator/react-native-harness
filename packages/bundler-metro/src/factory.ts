import {
  getReactNativeCliPath,
  getExpoCliPath,
  spawn,
  logger,
  SubprocessError,
} from '@react-native-harness/tools';
import type { ChildProcess } from 'child_process';
import { isPortAvailable } from './utils.js';
import {
  MetroPortUnavailableError,
  MetroBundlerNotReadyError,
} from './errors.js';
import { METRO_PORT } from './constants.js';
import type { MetroInstance } from './types.js';
import assert from 'node:assert';

const DEV_SERVER_READY_MESSAGE = 'Dev server ready';

const waitForReady = (
  metroProcess: ChildProcess,
  timeoutMs = 60000
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line prefer-const
    let stdoutListener: (data: Buffer) => void;
    // eslint-disable-next-line prefer-const
    let timer: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timer);
      assert(metroProcess.stdout, 'stdout is required');

      metroProcess.stdout.off('data', stdoutListener);
    };

    stdoutListener = (data) => {
      const text = data.toString();
      if (text.includes(DEV_SERVER_READY_MESSAGE)) {
        cleanup();
        resolve();
      }
    };

    assert(metroProcess.stdout, 'stdout is required');
    metroProcess.stdout.on('data', stdoutListener);

    timer = setTimeout(() => {
      cleanup();
      reject(new MetroBundlerNotReadyError(timeoutMs));
    }, timeoutMs);
  });
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
        DEBUG: '*',
      },
    }
  );

  const isDefaultPortAvailable = await isPortAvailable(METRO_PORT);

  if (!isDefaultPortAvailable) {
    throw new MetroPortUnavailableError(METRO_PORT);
  }

  const childProcess = await metro.nodeChildProcess;

  // Forward metro output to logger
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

  metro.catch((error) => {
    // This process is going to be killed by us, so we don't need to throw an error
    if (error instanceof SubprocessError && error.signalName === 'SIGTERM') {
      return;
    }

    logger.error('Metro crashed unexpectedly', error);
  });

  // Wait for Metro to be ready by monitoring stdout for "Dev server ready."
  await waitForReady(childProcess);

  return {
    dispose: async () => {
      const isKilled = childProcess.kill('SIGTERM');

      if (!isKilled) {
        childProcess.kill('SIGKILL');
      }
    },
  };
};
