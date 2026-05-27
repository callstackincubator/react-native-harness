import {
  createHarnessBridge,
  type HarnessBridge,
  type AppConnection,
} from '@react-native-harness/bridge/server';
import {
  HARNESS_BRIDGE_PATH,
  type HarnessContext,
  type BridgeEvents,
  type TestRunnerEvents,
  type TestExecutionOptions,
  type TestSuiteResult,
} from '@react-native-harness/bridge';
import {
  type AppLaunchOptions,
  type HarnessPlatform,
  type HarnessPlatformInitOptions,
  type HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import {
  getMetroInstance,
  isMetroCacheReusable,
  waitForMetroBackedAppReady,
  type MetroInstance,
  type MetroWebSocketEndpoint,
  type ReportableEvent,
} from '@react-native-harness/bundler-metro';
import {
  createHarnessPluginManager,
  type FlatHarnessHookContexts,
  type HarnessPlugin,
  type HarnessPluginManager,
  type HarnessRunStatus,
  type HarnessRunSummary,
} from '@react-native-harness/plugins';
import {
  logger,
  createCrashArtifactWriter,
  getTimeoutSignal,
  raceAbortSignals,
} from '@react-native-harness/tools';
import {
  getConfig,
  type Config as HarnessConfig,
  ConfigSchema,
} from '@react-native-harness/config';
import type { Config as JestConfig } from 'jest-runner';
import { preRunMessage } from 'jest-util';
import { PlatformReadyTimeoutError } from './errors.js';
import { NoRunnerSpecifiedError, RunnerNotFoundError } from './errors.js';
import { createCrashMonitor, type CrashMonitor } from './crash-monitor.js';
import { createHookQueue, type HookQueue } from './hook-queue.js';
import {
  createClientLogCollector,
  type ClientLogBuffer,
} from './client-log-handler.js';
import { createActionHooksPlugin } from './action-hooks.js';
import {
  createResourceLockManager,
  type ResourceLockManager,
  type ResourceLease,
} from './resource-lock.js';
import { resolveHarnessMetroPort } from './metro-port.js';
import { getAdditionalCliArgs } from './cli-args.js';
import {
  logMetroCacheReused,
  logMetroPortFallback,
  logNativeCoverageCollected,
  logRunnerStarting,
  logRunnerStillWaitingInQueue,
  logRunnerWaitingInQueue,
  logTestEnvironmentReady,
  logTestRunHeader,
} from './logs.js';

const sessionLogger = logger.child('runtime');
const defaultResourceLockManager = createResourceLockManager();
const ignorePromiseRejection = () => undefined;

export type HarnessRunState = {
  readonly runId: string;
  readonly startTime: number;
  readonly testFiles: string[];
  readonly watchMode: boolean;
  readonly coverageEnabled: boolean;
  readonly summary?: HarnessRunSummary;
  readonly status?: HarnessRunStatus;
  readonly error?: unknown;
};

export type HarnessRunTestsOptions = Exclude<TestExecutionOptions, 'platform'>;

export type HarnessSession = {
  readonly config: HarnessConfig;
  readonly context: HarnessContext;
  onTestRunnerEvent: (listener: (event: TestRunnerEvents) => void) => () => void;
  runTestFile: (path: string, options: HarnessRunTestsOptions) => Promise<TestSuiteResult>;
  ensureAppReady: (testFilePath: string) => Promise<void>;
  restartApp: (testFilePath?: string) => Promise<void>;
  resetCrashState: () => void;
  flushClientLogs: () => ClientLogBuffer;
  callHook: HarnessPluginManager<HarnessConfig, HarnessPlatform>['callHook'];
  setRunState: (state: HarnessRunState | null) => void;
  dispose: (reason?: 'normal' | 'abort' | 'error') => Promise<void>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

const waitForAbort = (signal: AbortSignal): Promise<never> => {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? createAbortError());
  }
  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(signal.reason ?? createAbortError()),
      { once: true },
    );
  });
};

const withPlatformReadyTimeout = async <T>(options: {
  timeout: number;
  signal: AbortSignal;
  work: (signal: AbortSignal) => Promise<T>;
}): Promise<T> => {
  const timeoutSignal = getTimeoutSignal(options.timeout);
  const combinedSignal = raceAbortSignals([options.signal, timeoutSignal]);
  try {
    return await options.work(combinedSignal);
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === 'AbortError' &&
      timeoutSignal.aborted &&
      !options.signal.aborted
    ) {
      throw new PlatformReadyTimeoutError(options.timeout);
    }
    throw error;
  }
};

type AppReadyOptions = {
  metroInstance: MetroInstance;
  bridge: HarnessBridge;
  platformInstance: HarnessPlatformRunner;
  platformId: string;
  bundleStartTimeout: number;
  readyTimeout: number;
  maxAppRestarts: number;
  crashMonitor: CrashMonitor;
  appLaunchOptions?: AppLaunchOptions;
};

const waitForAppReady = async (
  base: AppReadyOptions,
  testFilePath: string,
): Promise<void> => {
  const {
    metroInstance,
    bridge,
    platformInstance,
    platformId,
    bundleStartTimeout,
    readyTimeout,
    maxAppRestarts,
    crashMonitor,
    appLaunchOptions,
  } = base;

  const logWait = (message: string, ...args: unknown[]) =>
    sessionLogger.debug(`waitForAppReady: ${message}`, ...args);

  return await waitForMetroBackedAppReady({
    metro: metroInstance,
    platformId,
    bundleStartTimeout,
    readyTimeout,
    maxAppRestarts,
    signal: new AbortController().signal,
    startAttempt: async () => {
      logWait('launching app for %s', testFilePath);
      await platformInstance.restartApp(appLaunchOptions);
      logWait('launch request completed, waiting for bridge ready');
    },
    waitForReady: async (signal) => {
      logWait('waiting for runtime ready');
      // Listen for the NEXT 'connected' event rather than using nextConnection(),
      // because nextConnection() returns the existing connection immediately if one
      // is already set. waitForReady is called before startAttempt, so a stale
      // connection from a previous run would resolve the promise before startAttempt
      // even restarts the app — leaving bridge.connection null after the restart.
      await new Promise<void>((resolve, reject) => {
        const onConnected = (_conn: AppConnection) => { cleanup(); resolve(); };
        const onAbort = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
        const cleanup = () => {
          bridge.off('connected', onConnected);
          signal.removeEventListener('abort', onAbort);
        };
        if (signal.aborted) { onAbort(); return; }
        bridge.on('connected', onConnected);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      logWait('runtime ready received');
    },
    waitForCrash: async (signal) => {
      const watch = crashMonitor.watch(testFilePath, 'startup');
      watch.promise.catch(ignorePromiseRejection); // suppress unhandled-rejection when abort wins race
      try {
        logWait('waiting for crash or runtime ready');
        return await Promise.race([watch.promise, waitForAbort(signal)]);
      } finally {
        watch.cancel();
      }
    },
    onAttemptStart: () => {
      logWait('beginning launch attempt for %s', testFilePath);
    },
    onAttemptReset: () => {
      logWait('resetting launch attempt state');
    },
  });
};

const getDefaultResourceLockKey = (platform: HarnessPlatform): string =>
  `${platform.platformId}:${platform.name}`;

const buildBridgeHookScheduler = (
  hooks: HookQueue,
  pluginManager: HarnessPluginManager<HarnessConfig, HarnessPlatform>,
  getCurrentRunId: () => string | undefined,
) => (event: BridgeEvents) => {
  const runId = getCurrentRunId();
  if (!runId) return;

  const schedule = <TName extends keyof FlatHarnessHookContexts<object, HarnessConfig, HarnessPlatform>>(
    name: TName,
    payload: Omit<FlatHarnessHookContexts<object, HarnessConfig, HarnessPlatform>[TName], 'plugin' | 'logger' | 'projectRoot' | 'config' | 'runner' | 'platform' | 'state' | 'timestamp' | 'abortSignal' | 'meta'>,
  ) => hooks.schedule(() => pluginManager.callHook(name, payload));

  switch (event.type) {
    case 'collection-started':
      return schedule('collection:started', { runId, file: event.file });
    case 'collection-finished':
      return schedule('collection:finished', { runId, file: event.file, duration: event.duration, totalTests: event.totalTests });
    case 'suite-started':
      return schedule('suite:started', { runId, file: event.file, name: event.name });
    case 'suite-finished':
      return schedule('suite:finished', { runId, file: event.file, name: event.name, duration: event.duration, status: event.status, error: event.error });
    case 'test-started':
      return schedule('test:started', { runId, file: event.file, suite: event.suite, name: event.name });
    case 'test-finished':
      return schedule('test:finished', { runId, file: event.file, suite: event.suite, name: event.name, duration: event.duration, status: event.status, error: event.error });
    case 'module-bundling-started':
      return schedule('metro:bundle-started', { runId, target: 'module', file: event.file });
    case 'module-bundling-finished':
      return schedule('metro:bundle-finished', { runId, target: 'module', file: event.file, duration: event.duration });
    case 'module-bundling-failed':
      return schedule('metro:bundle-failed', { runId, target: 'module', file: event.file, duration: event.duration, error: event.error });
    case 'setup-file-bundling-started':
      return schedule('metro:bundle-started', { runId, target: 'setupFile', file: event.file, setupType: event.setupType });
    case 'setup-file-bundling-finished':
      return schedule('metro:bundle-finished', { runId, target: 'setupFile', file: event.file, setupType: event.setupType, duration: event.duration });
    case 'setup-file-bundling-failed':
      return schedule('metro:bundle-failed', { runId, target: 'setupFile', file: event.file, setupType: event.setupType, duration: event.duration, error: event.error });
  }
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const applyEnvVars = (
  harnessConfig: HarnessConfig,
  globalConfig: JestConfig.GlobalConfig,
): void => {
  if (globalConfig.collectCoverage) {
    process.env.RN_HARNESS_COLLECT_COVERAGE = 'true';
    if (harnessConfig.coverage?.root) {
      process.env.RN_HARNESS_COVERAGE_ROOT = harnessConfig.coverage.root;
    }
  }
  if (harnessConfig.disableViewFlattening) {
    process.env.RN_HARNESS_VIEW_FLATTENING = 'false';
  }
};

const loadConfig = async (globalConfig: JestConfig.GlobalConfig): Promise<{
  harnessConfig: HarnessConfig;
  platform: HarnessPlatform;
  projectRoot: string;
}> => {
  const projectRoot = globalConfig.rootDir;
  const { config: rawConfig } = await getConfig(projectRoot);

  const cliArgs = getAdditionalCliArgs();
  let harnessConfig = cliArgs.metroPort != null
    ? ConfigSchema.parse({ ...rawConfig, metroPort: cliArgs.metroPort })
    : rawConfig;

  if (process.env.PRE_RUN_HOOK || process.env.AFTER_RUN_HOOK) {
    harnessConfig = ConfigSchema.parse({
      ...harnessConfig,
      plugins: [...(harnessConfig.plugins ?? []), createActionHooksPlugin()],
    });
  }

  if (
    harnessConfig.webSocketPort != null &&
    harnessConfig.webSocketPort !== harnessConfig.metroPort
  ) {
    logger.warn(
      `Config option "webSocketPort" is deprecated and ignored. Harness now uses metroPort (${harnessConfig.metroPort}) for bridge traffic.`
    );
  }

  const selectedRunnerName = cliArgs.harnessRunner ?? harnessConfig.defaultRunner;
  if (!selectedRunnerName) throw new NoRunnerSpecifiedError();

  const platform = harnessConfig.runners.find((r) => r.name === selectedRunnerName);
  if (!platform) throw new RunnerNotFoundError(selectedRunnerName);

  return { harnessConfig, platform, projectRoot };
};

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

export const createHarnessSession = async (
  globalConfig: JestConfig.GlobalConfig,
  { lockManager = defaultResourceLockManager }: { lockManager?: ResourceLockManager } = {},
): Promise<HarnessSession> => {
  preRunMessage.remove(process.stderr);

  const { harnessConfig, platform, projectRoot } = await loadConfig(globalConfig);
  applyEnvVars(harnessConfig, globalConfig);

  sessionLogger.debug(
    'creating session for runner=%s platform=%s',
    platform.name,
    platform.platformId,
  );

  // Single AbortController for the entire setup phase. Registered signal
  // handlers abort this so that slow inflight operations (Metro init, platform
  // runner startup) are cancelled promptly on SIGTERM/SIGINT.
  const setupController = new AbortController();
  const onEarlySignal = () => setupController.abort();
  process.once('SIGTERM', onEarlySignal);
  process.once('SIGINT', onEarlySignal);

  const resourceLockKey = await (platform.getResourceLockKey?.() ?? getDefaultResourceLockKey(platform));
  let didWaitForResourceLock = false;
  let lastStillWaitingLogAt = 0;

  logTestRunHeader(platform);

  const resourceLease = await lockManager.acquire(resourceLockKey, {
    signal: setupController.signal,
    onWait: () => {
      didWaitForResourceLock = true;
      logRunnerWaitingInQueue(platform);
      sessionLogger.debug('waiting in queue for runner=%s key=%s', platform.name, resourceLockKey);
    },
    onStillWaiting: (elapsedMs) => {
      if (elapsedMs - lastStillWaitingLogAt < 5000) return;
      lastStillWaitingLogAt = elapsedMs;
      logRunnerStillWaitingInQueue(platform);
      sessionLogger.debug('still waiting in queue for runner=%s key=%s elapsedMs=%d', platform.name, resourceLockKey, elapsedMs);
    },
  });

  if (didWaitForResourceLock) logRunnerStarting(platform);
  sessionLogger.debug('resource lock acquired for runner=%s key=%s', platform.name, resourceLockKey);

  // Hoisted so the outer catch can release it even if an error occurs after
  // port resolution but before the inner try/catch (e.g. bridge creation failure).
  let metroPortLease: ResourceLease | null = null;

  try {
    const resolution = await resolveHarnessMetroPort({
      config: harnessConfig,
      platform,
      resourceLockManager: lockManager,
      signal: setupController.signal,
    });
    metroPortLease = resolution.metroPortLease;
    const { config: runtimeConfig, initialMetroPort, didFallback } = resolution;

    if (didFallback) logMetroPortFallback(initialMetroPort, runtimeConfig.metroPort);

    if (runtimeConfig.unstable__enableMetroCache && isMetroCacheReusable(projectRoot)) {
      logMetroCacheReused(platform);
    }

    const pluginAbortController = new AbortController();
    const pluginManager = createHarnessPluginManager<HarnessConfig, HarnessPlatform>({
      plugins: (runtimeConfig.plugins ?? []) as Array<HarnessPlugin<object, HarnessConfig, HarnessPlatform>>,
      projectRoot,
      config: runtimeConfig,
      runner: platform,
      abortSignal: pluginAbortController.signal,
    });

    const hooks = createHookQueue();
    let currentRun: HarnessRunState | null = null;
    const getCurrentRunId = () => currentRun?.runId;
    const clientLogCollector = createClientLogCollector();

    const context: HarnessContext = { platform };

    const bridge = await createHarnessBridge({
      noServer: true,
      timeout: runtimeConfig.bridgeTimeout,
      context,
    });
    sessionLogger.debug('bridge initialized on Metro websocket path %s', HARNESS_BRIDGE_PATH);

    let metroInstance: MetroInstance;
    let platformInstance: HarnessPlatformRunner;

    try {
      [metroInstance, platformInstance] = await Promise.all([
        getMetroInstance(
          {
            projectRoot,
            harnessConfig: runtimeConfig,
            websocketEndpoints: {
              [HARNESS_BRIDGE_PATH]: bridge.ws as unknown as MetroWebSocketEndpoint,
            },
          },
          setupController.signal,
        ).then((instance) => {
          sessionLogger.debug('Metro initialized');
          return instance;
        }),
        withPlatformReadyTimeout({
          timeout: runtimeConfig.platformReadyTimeout,
          signal: setupController.signal,
          work: async (signal) => {
            return await import(platform.runner).then((module) =>
              module.default(platform.config, runtimeConfig, {
                signal,
              } satisfies HarnessPlatformInitOptions),
            ).then((instance) => {
              sessionLogger.debug('platform runner initialized');
              return instance;
            });
          },
        }),
      ]);
    } catch (error) {
      // Only bridge needs cleanup here; leases are released by the outer catch.
      await bridge.dispose();
      throw error;
    }

    const crashArtifactWriter = createCrashArtifactWriter({
      runnerName: platform.name,
      platformId: platform.platformId,
    });
    const appMonitor = platformInstance.createAppMonitor({ crashArtifactWriter });
    const appLaunchOptions = (platform.config as { appLaunchOptions?: AppLaunchOptions }).appLaunchOptions;

    const crashMonitor = createCrashMonitor({ appMonitor, platformRunner: platformInstance });

    // Pre-build the options that are constant across all app-ready calls;
    // only testFilePath varies per call.
    const appReadyBaseOptions: AppReadyOptions = {
      metroInstance,
      bridge,
      platformInstance,
      platformId: platform.platformId,
      bundleStartTimeout: runtimeConfig.bundleStartTimeout ?? 60000,
      readyTimeout: runtimeConfig.bridgeTimeout,
      maxAppRestarts: runtimeConfig.maxAppRestarts ?? 2,
      crashMonitor,
      appLaunchOptions,
    };

    // --- Event listeners ---

    const bridgeEventListener = buildBridgeHookScheduler(hooks, pluginManager, getCurrentRunId);

    const onMetroEvent = (event: ReportableEvent) => {
      const runId = getCurrentRunId();
      if (runId && event.type === 'client_log') {
        hooks.schedule(() => pluginManager.callHook('metro:client-log', { runId, level: event.level, data: event.data }));
      }
    };

    const flushClientLogs = (): ClientLogBuffer => clientLogCollector.flush();

    const clientLogListener = clientLogCollector.handleEvent;
    const testRunnerEventListeners = new Set<(event: TestRunnerEvents) => void>();
    const onTestRunnerEvent = (event: BridgeEvents) => {
      if (
        event.type === 'test-started' ||
        event.type === 'test-finished' ||
        event.type === 'suite-started' ||
        event.type === 'suite-finished' ||
        event.type === 'file-started' ||
        event.type === 'file-finished'
      ) {
        testRunnerEventListeners.forEach((listener) => listener(event));
      }
    };

    const onConnected = (conn: AppConnection) => {
      const runId = getCurrentRunId();
      if (!runId) return;
      hooks.schedule(() => pluginManager.callHook('runtime:ready', { runId, device: conn.device }));
    };

    const onDisconnected = () => {
      const runId = getCurrentRunId();
      if (!runId) return;
      hooks.schedule(() => pluginManager.callHook('runtime:disconnected', { runId, reason: 'bridge-disconnected' }));
    };

    bridge.on('connected', onConnected);
    bridge.on('disconnected', onDisconnected);
    bridge.on('event', bridgeEventListener);
    bridge.on('event', onTestRunnerEvent);
    metroInstance.events.addListener(onMetroEvent);
    if (runtimeConfig.forwardClientLogs) {
      metroInstance.events.addListener(clientLogListener);
    }

    sessionLogger.debug('registered runtime, bridge, and Metro listeners');

    // --- Dispose ---

    let disposePromise: Promise<void> | null = null;

    const disposeOnce = async (reason: 'normal' | 'abort' | 'error') => {
      sessionLogger.debug('disposing session (reason=%s)', reason);
      let hookError: unknown;

      try {
        await hooks.drain();
        await pluginManager.callHook('harness:after-run', {
          runId: currentRun?.runId,
          reason,
          summary: currentRun?.summary,
          status: currentRun?.status,
          error: currentRun?.error,
        });
        await hooks.drain();
        await pluginManager.callHook('harness:before-dispose', {
          runId: currentRun?.runId,
          reason,
          summary: currentRun?.summary,
          status: currentRun?.status,
          error: currentRun?.error,
        });
        await hooks.drain();
      } catch (error) {
        hookError = error;
      }

      if (runtimeConfig.forwardClientLogs) {
        metroInstance.events.removeListener(clientLogListener);
      }
      metroInstance.events.removeListener(onMetroEvent);
      bridge.off('connected', onConnected);
      bridge.off('disconnected', onDisconnected);
      bridge.off('event', bridgeEventListener);
      bridge.off('event', onTestRunnerEvent);

      const nativeCoverageConfig = runtimeConfig.coverage?.native?.ios;
      if (nativeCoverageConfig?.pods?.length && platformInstance.collectNativeCoverage) {
        try {
          await platformInstance.stopApp();
          const lcovPath = await platformInstance.collectNativeCoverage({
            pods: nativeCoverageConfig.pods,
            outputDir: projectRoot,
          });
          if (lcovPath) {
            logNativeCoverageCollected(lcovPath);
          }
        } catch (error) {
          sessionLogger.warn('failed to collect native coverage: %s', error);
        }
      }

      let cleanupError: unknown;
      try {
        await Promise.all([
          crashMonitor.dispose(),
          bridge.dispose(),
          platformInstance.dispose(),
          metroInstance.dispose(),
          metroPortLease?.release(),
        ]);
      } catch (error) {
        cleanupError = error;
      } finally {
        await resourceLease.release();
        pluginAbortController.abort();
      }

      sessionLogger.debug('session resources disposed');

      if (hookError) throw hookError;
      if (cleanupError) throw cleanupError;
    };

    const dispose = (reason: 'normal' | 'abort' | 'error' = 'normal') => {
      disposePromise ??= disposeOnce(reason);
      return disposePromise;
    };

    // Switch from setup-phase signal handling to dispose-based handling now
    // that all infrastructure is up.
    process.off('SIGTERM', onEarlySignal);
    process.off('SIGINT', onEarlySignal);
    const onSignal = () => void dispose('abort').then(() => process.exit(0));
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);

    // --- Startup hooks ---

    try {
      await pluginManager.callHook('harness:before-creation', { appLaunchOptions });
      await hooks.drain();
      await appMonitor.start();
      sessionLogger.debug('app monitor started');
      await pluginManager.callHook('harness:before-run', { appLaunchOptions });
      await hooks.drain();
    } catch (error) {
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      await dispose('error');
      throw error;
    }

    logTestEnvironmentReady(platform);
    sessionLogger.debug('session ready');

    // --- Public API ---

    const ensureAppReady = async (testFilePath: string): Promise<void> => {
      await hooks.drain();
      sessionLogger.debug('ensuring app is ready for %s', testFilePath);

      if (crashMonitor.isAlive() && bridge.connection !== null && await platformInstance.isAppRunning()) {
        sessionLogger.debug('reusing existing ready app for %s', testFilePath);
        return;
      }

      crashMonitor.reset();
      sessionLogger.debug('app not ready, waiting for launch and runtime readiness');
      await waitForAppReady(appReadyBaseOptions, testFilePath);
      await hooks.drain();
      sessionLogger.debug('app is ready for %s', testFilePath);
    };

    const restartApp = async (testFilePath?: string): Promise<void> => {
      await hooks.drain();
      await crashMonitor.stop();
      sessionLogger.debug(
        'restarting app (testFile=%s mode=%s)',
        testFilePath ?? 'n/a',
        testFilePath ? 'stop-and-ensure-ready' : 'direct-restart',
      );

      if (testFilePath) {
        await platformInstance.stopApp();
      } else {
        await platformInstance.restartApp(appLaunchOptions);
      }

      crashMonitor.reset();
      await crashMonitor.start();

      if (testFilePath) {
        await ensureAppReady(testFilePath);
      }

      await hooks.drain();
      sessionLogger.debug('restart completed');
    };

    const runTestFile = async (
      testPath: string,
      options: HarnessRunTestsOptions,
    ): Promise<TestSuiteResult> => {
      await hooks.drain();
      const conn = bridge.connection;
      if (!conn) throw new Error('No active app connection');
      sessionLogger.debug('running test file on client: %s', testPath);

      if (!runtimeConfig.detectNativeCrashes) {
        const result = await conn.runTests(testPath, { ...options, runner: platform.runner });
        await hooks.drain();
        return result;
      }

      const crashWatch = crashMonitor.watch(testPath, 'execution');
      // Attach a handler now so the rejection is always observed, whether the
      // crash wins the race or cancel() is called after the test run wins.
      crashWatch.promise.catch(ignorePromiseRejection);
      try {
        const result = await Promise.race([
          conn.runTests(testPath, { ...options, runner: platform.runner }),
          crashWatch.promise,
        ]);
        await hooks.drain();
        return result;
      } finally {
        crashWatch.cancel();
      }
    };

    return {
      config: runtimeConfig,
      context,
      onTestRunnerEvent: (listener) => {
        testRunnerEventListeners.add(listener);
        return () => {
          testRunnerEventListeners.delete(listener);
        };
      },
      runTestFile,
      ensureAppReady,
      restartApp,
      resetCrashState: () => crashMonitor.reset(),
      flushClientLogs,
      callHook: async (name, payload) => {
        await hooks.drain();
        await pluginManager.callHook(name, payload);
        await hooks.drain();
      },
      setRunState: (state) => {
        currentRun = state;
      },
      dispose: (reason = 'normal') => {
        process.off('SIGTERM', onSignal);
        process.off('SIGINT', onSignal);
        return dispose(reason);
      },
    };
  } catch (error) {
    process.off('SIGTERM', onEarlySignal);
    process.off('SIGINT', onEarlySignal);
    await Promise.allSettled([resourceLease.release(), metroPortLease?.release()]);
    throw error;
  }
};
