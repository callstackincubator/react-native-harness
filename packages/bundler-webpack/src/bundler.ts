import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import webpackDevMiddleware from 'webpack-dev-middleware';
import { getEmitter, logger, waitForAbort } from '@react-native-harness/tools';
import type {
  BundlerEvent,
  BundlerHealth,
  BundlerInstance,
  HarnessBundlerFactory,
  PrewarmState,
} from '@react-native-harness/bundlers';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { observeCompiler } from './bundler-events.js';
import { getCompilerFactory } from './compiler-package.js';
import { composeConfig } from './compose-config.js';
import { COMPILERS } from './compilers.js';
import { UnsupportedPlatformError, WatchModeUnsupportedError } from './errors.js';
import {
  getGeneratedPaths,
  renderEntryModule,
  renderTestFilesModule,
  writeIfChanged,
} from './generated-files.js';
import { loadConfig } from './load-config.js';
import { isPageRequest } from './page-request.js';
import { getRuntimeModulesDir } from './runtime-modules-dir.js';
import { startServer } from './server.js';
import { handleSymbolicate } from './symbolicate.js';
import type { WebpackBundlerConfig } from './types.js';

const require = createRequire(import.meta.url);
const bundlerLogger = logger.child('webpack');

const WEB_PLATFORM_ID = 'web';

const RESOLVE_WEAK_LOADER = fileURLToPath(
  new URL('../resolve-weak-loader.cjs', import.meta.url)
);

type DevMiddleware = ReturnType<typeof webpackDevMiddleware>;

const createWebpackBundler: HarnessBundlerFactory<
  WebpackBundlerConfig,
  HarnessConfig
> = async (options, signal): Promise<BundlerInstance> => {
  const {
    config: bundlerConfig,
    projectRoot,
    harnessConfig,
    websocketEndpoints,
    platform,
    watchMode,
  } = options;
  const { displayName } = COMPILERS[bundlerConfig.compiler];

  if (platform.platformId !== WEB_PLATFORM_ID) {
    throw new UnsupportedPlatformError(displayName, platform.platformId);
  }

  // Needs the page to reload when the build changes, and the files of a later
  // run to reach a page that is already open.
  if (watchMode) {
    throw new WatchModeUnsupportedError(displayName);
  }

  // Set by Metro's factory too; the project's config can read it.
  process.env.RN_HARNESS = 'true';

  const configFile = path.resolve(projectRoot, bundlerConfig.config);
  const createCompiler = getCompilerFactory(
    bundlerConfig.compiler,
    projectRoot,
    configFile
  );
  const userConfig = await loadConfig(projectRoot, bundlerConfig.config);
  signal.throwIfAborted();

  const paths = getGeneratedPaths(projectRoot, harnessConfig.metroPort);
  const renderFiles = (files: readonly string[]) =>
    renderTestFilesModule({ files, projectRoot, fromDir: paths.dir });
  writeIfChanged(paths.entry, renderEntryModule(harnessConfig));
  writeIfChanged(paths.testFiles, renderFiles([]));

  const compiler = createCompiler(
    composeConfig(userConfig, {
      projectRoot,
      entryPoint: harnessConfig.entryPoint,
      harnessEntry: paths.entry,
      testFilesModule: paths.testFiles,
      jestGlobalsMock: require.resolve(
        '@react-native-harness/bundlers/jest-globals-mock'
      ),
      resolveWeakLoader: RESOLVE_WEAK_LOADER,
      fallbackModulesDir: getRuntimeModulesDir(projectRoot),
    })
  );

  const events = getEmitter<BundlerEvent>();
  let status = 'waiting for the files of the run';
  let resolveFirstBuild!: (ok: boolean) => void;
  const firstBuild = new Promise<boolean>((resolve) => {
    resolveFirstBuild = resolve;
  });

  const observer = observeCompiler({
    compiler,
    platform: platform.platformId,
    entryFile: harnessConfig.entryPoint,
    emit: events.emit,
    onBuildFinished: ({ ok, stats }) => {
      status = ok ? 'built' : 'the last build failed';

      if (!ok) {
        bundlerLogger.error(
          stats?.toString({ all: false, errors: true }) ??
            `${displayName} could not build the app.`
        );
      }

      // `stats: 'none'` keeps the middleware quiet, so warnings, such as a
      // file the resolve-weak loader could not read, are shown here.
      const warnings = ok
        ? stats?.toString({ all: false, warnings: true }).trim()
        : '';

      if (warnings) {
        bundlerLogger.warn(warnings);
      }

      resolveFirstBuild(ok);
    },
  });

  let middleware: DevMiddleware | null = null;

  // The first compilation starts here, once there are files to compile.
  const startCompilation = () => {
    if (middleware) {
      return;
    }

    status = 'building';
    middleware = webpackDevMiddleware(compiler as never, {
      stats: 'none',
      writeToDisk: false,
      headers: { 'Cache-Control': 'no-store' },
    });
  };

  const onRequest = (request: IncomingMessage, response: ServerResponse) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'POST' && pathname === '/symbolicate') {
      void handleSymbolicate(request, response);
      return;
    }

    if (!middleware) {
      response.statusCode = 503;
      response.end('The files of the run have not been received yet.');
      return;
    }

    if (isPageRequest(request)) {
      events.emit({
        type: 'entry_requested',
        platform: platform.platformId,
        requestKind: 'app',
      });
    }

    middleware(request as never, response as never, () => {
      response.statusCode = 404;
      response.end('Not found');
    });
  };

  const host = harnessConfig.host?.trim() || undefined;
  const harnessServer = await startServer({
    port: harnessConfig.metroPort,
    host,
    onRequest,
    websocketEndpoints,
  });

  if (signal.aborted) {
    await harnessServer.close();
    signal.throwIfAborted();
  }

  bundlerLogger.debug(
    '%s server is running on port %d',
    displayName,
    harnessConfig.metroPort
  );

  let prewarmState: PrewarmState = 'idle';
  let prewarmResult: Promise<boolean> | null = null;
  let disposePromise: Promise<void> | null = null;

  return {
    events,
    waitUntilHealthy: async (): Promise<BundlerHealth> => ({
      healthy: true,
      status: `listening on port ${harnessConfig.metroPort}, ${status}`,
    }),
    // Waits for the first compilation, which starts when the run's files
    // arrive. Later calls get the same answer.
    prewarm: ({ signal: prewarmSignal }) => {
      if (!prewarmResult) {
        prewarmState = 'pending';
        prewarmResult = (async () => {
          const abortWait = waitForAbort(prewarmSignal);

          try {
            const ok = await Promise.race([firstBuild, abortWait.promise]);
            prewarmState = ok ? 'succeeded' : 'failed';

            if (!ok) {
              bundlerLogger.warn(
                `${displayName} could not build the app; continuing without a prewarmed build.`
              );
            }

            return ok;
          } catch (error) {
            prewarmState = 'failed';
            throw error;
          } finally {
            abortWait.cancel();
          }
        })();
      }

      return prewarmResult;
    },
    getPrewarmState: () => prewarmState,
    isBuildInFlight: () => observer.isBuildInFlight(),
    setRunFiles: async ({ files }) => {
      writeIfChanged(paths.testFiles, renderFiles(files));
      startCompilation();
    },
    dispose: () => {
      disposePromise ??= (async () => {
        observer.dispose();
        await harnessServer.close();

        const running = middleware;

        if (running) {
          await new Promise<void>((resolve) => running.close(() => resolve()));
        }

        await new Promise<void>((resolve) => compiler.close(() => resolve()));
        fs.rmSync(paths.dir, { recursive: true, force: true });
      })();

      return disposePromise;
    },
  };
};

export default createWebpackBundler;
