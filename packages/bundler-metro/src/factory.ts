import { logger, withAbortTimeout } from '@react-native-harness/tools';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import connect from 'connect';
import nocache from 'nocache';
import { isPortAvailable, getMetroPackage } from './utils.js';
import { MetroPortUnavailableError } from './errors.js';
import type { MetroInstance, MetroOptions } from './types.js';
import {
  type Reporter,
  withReporter,
  type ReportableEvent,
} from './reporter.js';
import { getExpoMiddleware } from './middlewares/expo-middleware.js';
import { getBundleRequestObserverMiddleware } from './middlewares/bundle-request-middleware.js';
import { getStatusMiddleware } from './middlewares/status-middleware.js';
import { prewarmMetroBundle } from './prewarm.js';
import { withRnHarness } from './withRnHarness.js';
const metroLogger = logger.child('metro');

const METRO_STATUS_POLL_INTERVAL_MS = 500;
const METRO_STATUS_REQUEST_TIMEOUT_MS = 1000;

const getMetroStatusUrl = (port: number) => `http://localhost:${port}/status`;

const waitForMetroStatus = async (options: {
  port: number;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<string> => {
  const { port, timeoutMs, signal } = options;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'waiting for first /status response';

  while (Date.now() < deadline) {
    signal.throwIfAborted();

    try {
      const response = await fetch(getMetroStatusUrl(port), {
        signal: withAbortTimeout(signal, METRO_STATUS_REQUEST_TIMEOUT_MS),
      });
      const body = await response.text();

      lastStatus = `HTTP ${response.status}: ${body.trim()}`;

      if (response.ok && body.includes('packager-status:running')) {
        return lastStatus;
      }
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === 'AbortError' &&
        signal.aborted
      ) {
        throw error;
      }

      lastStatus = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, METRO_STATUS_POLL_INTERVAL_MS)
    );
  }

  return lastStatus;
};

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
  const { projectRoot, harnessConfig } = options;
  const metroPort = harnessConfig.metroPort;
  metroLogger.debug(
    'creating Metro instance for %s on port %d',
    projectRoot,
    metroPort
  );
  const isMetroPortAvailable = await isPortAvailable(metroPort);

  if (!isMetroPortAvailable) {
    throw new MetroPortUnavailableError(metroPort);
  }

  const Metro = getMetroPackage(projectRoot);

  process.env.RN_HARNESS = 'true';

  const projectMetroConfig = await Metro.loadConfig({
    port: metroPort,
    projectRoot,
  });
  const config = await withRnHarness(projectMetroConfig, true)();
  const reporter = withReporter(config);

  abortSignal.throwIfAborted();

  const middleware = connect()
    .use(nocache())
    .use('/', getBundleRequestObserverMiddleware(projectRoot, harnessConfig, reporter))
    .use('/', getExpoMiddleware(projectRoot, harnessConfig))
    .use('/status', getStatusMiddleware(projectRoot));

  const ready = waitForBundler(reporter, abortSignal);
  const metroBindHost = harnessConfig.host?.trim();
  if (metroBindHost) {
    metroLogger.debug('binding Metro server to host %s', metroBindHost);
  }

  const maybeServer = await Metro.runServer(config, {
    waitForBundler: true,
    unstable_extraMiddleware: [middleware],
    ...(metroBindHost ? { host: metroBindHost } : {}),
    watch: process.env.CI ? false : undefined,
  });

  // Metro <0.83 returns the server directly, while 0.83+ returns an object with the server as a property.
  const server: HttpServer | HttpsServer =
    'httpServer' in maybeServer ? maybeServer.httpServer : maybeServer;
  server.keepAliveTimeout = 30000;

  abortSignal.throwIfAborted();

  await ready;

  metroLogger.debug('Metro server is running');

  let prewarmResult: Promise<boolean> | null = null;

  return {
    events: reporter,
    waitUntilHealthy: async ({ timeoutMs, signal }) =>
      waitForMetroStatus({ port: metroPort, timeoutMs, signal }),
    prewarm: ({ platform, signal }) => {
      if (!prewarmResult) {
        prewarmResult = (async () => {
          try {
            await prewarmMetroBundle({
              projectRoot,
              entryPoint: harnessConfig.entryPoint,
              port: metroPort,
              platform,
              dev: true,
              minify: false,
              signal,
            });
            return true;
          } catch (error) {
            if (
              error instanceof DOMException &&
              error.name === 'AbortError' &&
              signal.aborted
            ) {
              throw error;
            }

            logger.warn(
              `Metro pre-warm for ${platform} failed; continuing without pre-warm.`,
              error
            );
            return false;
          }
        })();
      }

      return prewarmResult;
    },
    dispose: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
};
