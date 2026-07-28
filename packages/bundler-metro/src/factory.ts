import { logger, withAbortTimeout } from '@react-native-harness/tools';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Socket } from 'node:net';
import connect from 'connect';
import nocache from 'nocache';
import { isPortAvailable, getMetroPackage } from './utils.js';
import { MetroPortUnavailableError } from './errors.js';
import type { MetroInstance, MetroOptions, PrewarmState } from './types.js';
import {
  type Reporter,
  withReporter,
  type ReportableEvent,
} from './reporter.js';
import { getExpoMiddleware } from './middlewares/expo-middleware.js';
import { getBundleRequestObserverMiddleware } from './middlewares/bundle-request-middleware.js';
import { getStatusMiddleware } from './middlewares/status-middleware.js';
import { buildPrewarmUrl, prewarmMetroBundle } from './prewarm.js';
import { detectBundleClientProfile } from './bundle-url.js';
import { diffGraphRelevantParams } from './prewarm-guard.js';
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
  const {
    projectRoot,
    harnessConfig,
    websocketEndpoints = {},
    watchMode = false,
  } = options;
  const metroPort = harnessConfig.metroPort;
  const metroBindHost = harnessConfig.host?.trim();
  metroLogger.debug(
    'creating Metro instance for %s on port %d',
    projectRoot,
    metroPort
  );
  const isMetroPortAvailable = await isPortAvailable(metroPort, metroBindHost);

  if (!isMetroPortAvailable) {
    throw new MetroPortUnavailableError(metroPort);
  }

  const Metro = getMetroPackage(projectRoot);
  const bundleClientProfile = detectBundleClientProfile(projectRoot);
  metroLogger.debug(
    'detected bundle client profile "%s" for %s',
    bundleClientProfile,
    projectRoot
  );

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
    .use(
      '/',
      getBundleRequestObserverMiddleware(projectRoot, harnessConfig, reporter)
    )
    .use('/', getExpoMiddleware(projectRoot, harnessConfig))
    .use('/status', getStatusMiddleware(projectRoot));

  const ready = waitForBundler(reporter, abortSignal);
  if (metroBindHost) {
    metroLogger.debug('binding Metro server to host %s', metroBindHost);
  }

  const maybeServer = await Metro.runServer(config, {
    waitForBundler: true,
    unstable_extraMiddleware: [middleware],
    websocketEndpoints,
    ...(metroBindHost ? { host: metroBindHost } : {}),
    watch: watchMode && !process.env.CI,
  });

  // Metro <0.83 returns the server directly, while 0.83+ returns an object with the server as a property.
  const server: HttpServer | HttpsServer =
    'httpServer' in maybeServer ? maybeServer.httpServer : maybeServer;
  server.keepAliveTimeout = 30000;

  // closeAllConnections() does not close sockets upgraded to WebSockets (e.g. Metro's /hot
  // endpoint), but those sockets block server.close() from ever firing its callback; track them
  // so dispose() can force-destroy whatever remains.
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  abortSignal.throwIfAborted();

  await ready;

  metroLogger.debug('Metro server is running');

  let prewarmResult: Promise<boolean> | null = null;
  let prewarmRequestUrl: string | null = null;
  let mismatchWarned = false;

  const onBundleRequestObserved = (event: ReportableEvent) => {
    if (event.type !== 'bundle_request_observed') {
      return;
    }

    if (event.requestKind !== 'app' || !prewarmRequestUrl || mismatchWarned) {
      return;
    }

    const diffs = diffGraphRelevantParams(prewarmRequestUrl, event.url);

    if (diffs.length > 0) {
      mismatchWarned = true;
      metroLogger.warn(
        'Pre-warmed Metro bundle graph key does not match the app-requested bundle graph key; the pre-warm may have built a graph the app cannot reuse. Mismatched: %s',
        diffs.join(', ')
      );
    }
  };
  reporter.addListener(onBundleRequestObserved);

  let prewarmState: PrewarmState = 'idle';

  let buildsInFlight = 0;
  const onBuildEvent = (event: ReportableEvent) => {
    if (event.type === 'bundle_build_started') {
      buildsInFlight += 1;
      return;
    }

    if (
      event.type === 'bundle_build_done' ||
      event.type === 'bundle_build_failed'
    ) {
      buildsInFlight = Math.max(0, buildsInFlight - 1);
    }
  };
  reporter.addListener(onBuildEvent);

  return {
    events: reporter,
    httpServer: server,
    websocketEndpoints,
    waitUntilHealthy: async ({ timeoutMs, signal }) =>
      waitForMetroStatus({ port: metroPort, timeoutMs, signal }),
    prewarm: ({ platform, signal }) => {
      if (!prewarmResult) {
        prewarmState = 'pending';
        prewarmResult = (async () => {
          try {
            const prewarmOptions = {
              projectRoot,
              entryPoint: harnessConfig.entryPoint,
              port: metroPort,
              platform,
              profile: bundleClientProfile,
            };
            prewarmRequestUrl = buildPrewarmUrl(prewarmOptions);
            await prewarmMetroBundle({
              ...prewarmOptions,
              signal,
            });
            prewarmState = 'succeeded';
            return true;
          } catch (error) {
            if (
              error instanceof DOMException &&
              error.name === 'AbortError' &&
              signal.aborted
            ) {
              prewarmState = 'failed';
              throw error;
            }

            logger.warn(
              `Metro pre-warm for ${platform} failed; continuing without pre-warm.`,
              error
            );
            prewarmState = 'failed';
            return false;
          }
        })();
      }

      return prewarmResult;
    },
    getPrewarmState: () => prewarmState,
    isBuildInFlight: () => buildsInFlight > 0,
    dispose: () =>
      new Promise<void>((resolve) => {
        reporter.removeListener(onBundleRequestObserved);
        reporter.removeListener(onBuildEvent);
        server.close(() => resolve());
        server.closeAllConnections();
        for (const socket of sockets) {
          socket.destroy();
        }
      }),
  };
};
