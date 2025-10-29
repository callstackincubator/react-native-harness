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
import { createRequire } from 'node:module';

const INITIALIZATION_DONE_EVENT_TYPE = 'initialize_done';

const require = createRequire(import.meta.url);

const waitForReady = (
  metroProcess: ChildProcess,
  timeoutMs = 60000
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const customPipe = metroProcess.stdio[3];
    assert(customPipe, 'customPipe is required');

    // eslint-disable-next-line prefer-const
    let pipeListener: (data: Buffer) => void;
    // eslint-disable-next-line prefer-const
    let timer: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timer);
      customPipe.off('data', pipeListener);
    };

    pipeListener = (data) => {
      const text = data.toString().split('\n');

      for (const line of text) {
        if (line.trim() === '') {
          continue;
        }

        try {
          const event = JSON.parse(line);

          if (event.type === INITIALIZATION_DONE_EVENT_TYPE) {
            cleanup();
            resolve();
          }
        } catch (error) {
          logger.error('Failed to parse event', error);
        }
      }
    };

    customPipe.on('data', pipeListener);

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
      '--customLogReporterPath',
      require.resolve('../assets/reporter.cjs'),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        RN_HARNESS: 'true',
        ...(isExpo && { EXPO_NO_METRO_WORKSPACE_ROOT: 'true' }),
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
