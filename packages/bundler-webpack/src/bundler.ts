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
import { createBuildSnapshot, type BuildSnapshot } from './build-snapshot.js';
import { createBuildState } from './build-state.js';
import { getCompilerFactory } from './compiler-package.js';
import { composeConfig } from './compose-config.js';
import { readOutputFile, type DevMiddleware } from './dev-middleware.js';
import { COMPILERS } from './compilers.js';
import { UnsupportedPlatformError } from './errors.js';
import { renderPage } from './generated-page.js';
import {
  getGeneratedPaths,
  renderEntryModule,
  renderTestFilesModule,
  writeIfChanged,
} from './generated-files.js';
import { createHarnessFileMatcher } from './harness-files.js';
import { loadConfig } from './load-config.js';
import { isPageRequest } from './page-request.js';
import { getRuntimeModulesDir } from './runtime-modules-dir.js';
import { startServer } from './server.js';
import { getIdleLimitMs, waitForRunBuild } from './watch-run.js';
import { createSourceMapProvider } from './source-maps.js';
import { handleSymbolicate } from './symbolicate.js';
import { symbolicateStack, type StackFrame } from './symbolicate-stack.js';
import type { WebpackBundlerConfig } from './types.js';

const require = createRequire(import.meta.url);
const bundlerLogger = logger.child('webpack');

const WEB_PLATFORM_ID = 'web';

const RESOLVE_WEAK_LOADER = fileURLToPath(
  new URL('../resolve-weak-loader.cjs', import.meta.url)
);

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
  const renderFiles = (files: readonly string[], marker?: string) =>
    renderTestFilesModule({ files, projectRoot, fromDir: paths.dir, marker });
  writeIfChanged(paths.entry, renderEntryModule(harnessConfig));
  writeIfChanged(paths.testFiles, renderFiles([]));

  const isHarnessFile = createHarnessFileMatcher(projectRoot);
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
      isHarnessFile,
      watch: watchMode,
      coverage: Boolean(process.env.RN_HARNESS_COLLECT_COVERAGE),
    })
  );

  const state = createBuildState();
  let snapshot: BuildSnapshot | null = null;
  let middleware: DevMiddleware | null = null;

  const sourceMaps = createSourceMapProvider({
    getSnapshot: () => snapshot,
    readAsset: (name) => readOutputFile(middleware, compiler.outputPath, name),
  });
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
    onInvalid: () => state.invalidated(),
    onWatchRun: (files) => state.watchRunStarted(files),
    onBuildFinished: ({ ok, stats }) => {
      status = ok ? 'built' : 'the last build failed';
      snapshot = stats ? createBuildSnapshot(stats, snapshot) : snapshot;
      sourceMaps.reset();
      state.buildFinished(stats ? (snapshot?.hash ?? null) : null);

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

  // Resolves once the compilation is valid, so that a stack is not mapped
  // with the maps of a build that the next one is replacing.
  const untilValid = (): Promise<void> =>
    new Promise((resolve) => {
      if (middleware) {
        middleware.waitUntilValid(() => resolve());
      } else {
        resolve();
      }
    });

  const symbolicate = async (stack: StackFrame[]) => {
    await untilValid();

    return symbolicateStack(stack, {
      getSourceMap: sourceMaps.getSourceMap,
      context: compiler.options.context ?? projectRoot,
      isInternalFile: isHarnessFile,
    });
  };

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

  // A project whose build emits no HTML has no page for the runtime to mount
  // into, and a page request would be a 404: `generated-page.ts` answers it.
  const sendGeneratedPage = (response: ServerResponse) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(renderPage(snapshot as BuildSnapshot));
  };

  const onRequest = (request: IncomingMessage, response: ServerResponse) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'POST' && pathname === '/symbolicate') {
      void handleSymbolicate(request, response, symbolicate);
      return;
    }

    if (!middleware) {
      response.statusCode = 503;
      response.end('The files of the run have not been received yet.');
      return;
    }

    const isPage = isPageRequest(request);

    if (isPage) {
      events.emit({
        type: 'entry_requested',
        platform: platform.platformId,
        requestKind: 'app',
      });
      // Counted once the page is served, so it is the build that served it.
      response.on('finish', () => {
        if (response.statusCode === 200) {
          state.pageLoaded();
        }
      });
    }

    middleware(request as never, response as never, () => {
      if (isPage && snapshot) {
        sendGeneratedPage(response);
        return;
      }

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

  let runCount = 0;
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
    isBuildInFlight: () => state.isBuilding(),
    // In watch mode the page the app loaded may be older than the build: it
    // never fetches a chunk twice, and its manifest lists the files of an
    // earlier run. Each call rewrites the manifest with a marker of its own and
    // waits for the build that picks that write up. The compiler's watcher
    // reports the write after the edits made before it, so that build holds
    // them too. The first call, and every call in a one-shot run, resolves
    // without waiting for a build.
    setRunFiles: async ({ files }) => {
      if (!middleware || !watchMode) {
        writeIfChanged(paths.testFiles, renderFiles(files));
        startCompilation();
        return { reloadRequired: false };
      }

      runCount += 1;
      const marker = `${Date.now()}-${runCount}`;

      return waitForRunBuild({
        state,
        manifests: [paths.testFiles, fs.realpathSync(paths.dir) + path.sep + path.basename(paths.testFiles)],
        writeManifest: () =>
          writeIfChanged(paths.testFiles, renderFiles(files, marker)),
        bundlerName: displayName,
        idleLimitMs: getIdleLimitMs(userConfig.watchOptions),
      });
    },
    dispose: () => {
      disposePromise ??= (async () => {
        observer.dispose();
        state.dispose();
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
