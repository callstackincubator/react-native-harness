import { withRnHarness } from '@react-native-harness/metro';
import { logger } from '@react-native-harness/tools';
import type { IncomingMessage, ServerResponse } from 'node:http';
import connect from 'connect';
import nocache from 'nocache';
import { isPortAvailable, getMetroPackage } from './utils.js';
import { MetroPortUnavailableError } from './errors.js';
import { METRO_PORT } from './constants.js';
import type { MetroInstance, MetroOptions } from './types.js';
import {
  type Reporter,
  withReporter,
  type ReportableEvent,
} from './reporter.js';

const waitForBundler = async (
  reporter: Reporter,
  abortSignal: AbortSignal
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const onEvent = (event: ReportableEvent) => {
      if (event.type === 'initialize_done') {
        reporter.removeListener(onEvent);
        resolve();
      }
    };
    reporter.addListener(onEvent);

    abortSignal.addEventListener('abort', () => {
      reporter.removeListener(onEvent);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    });
  });
};

export const getMetroInstance = async (
  options: MetroOptions,
  abortSignal: AbortSignal
): Promise<MetroInstance> => {
  const { projectRoot } = options;
  const isDefaultPortAvailable = await isPortAvailable(METRO_PORT);

  if (!isDefaultPortAvailable) {
    throw new MetroPortUnavailableError(METRO_PORT);
  }

  const Metro = getMetroPackage(projectRoot);

  process.env.RN_HARNESS = 'true';

  const projectMetroConfig = await Metro.loadConfig({
    port: METRO_PORT,
    projectRoot,
  });
  const config = await withRnHarness(projectMetroConfig, true)();
  const reporter = withReporter(config);

  abortSignal.throwIfAborted();

  const statusPageMiddleware = (_: IncomingMessage, res: ServerResponse) => {
    res.setHeader(
      'X-React-Native-Project-Root',
      new URL(`file:///${projectRoot}`).pathname.slice(1)
    );
    res.end('packager-status:running');
  };
  const middleware = connect()
    .use(nocache())
    .use('/status', statusPageMiddleware);

  const ready = waitForBundler(reporter, abortSignal);
  const server = await Metro.runServer(config, {
    waitForBundler: true,
    unstable_extraMiddleware: [middleware],
  });
  server.keepAliveTimeout = 30000;

  abortSignal.throwIfAborted();

  await ready;

  logger.debug('Metro server is running');

  return {
    events: reporter,
    dispose: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};
