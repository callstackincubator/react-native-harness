import {
  getBridgeServer,
  type BridgeServer,
} from '@react-native-harness/bridge/server';
import {
  HARNESS_BRIDGE_PATH,
  type HarnessContext,
  type BridgeEvents,
  type DeviceDescriptor,
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
import { createClientLogListener } from './client-log-handler.js';
import { createActionHooksPlugin } from './action-hooks.js';
import { createResourceLockManager } from './resource-lock.js';
import { resolveHarnessMetroPort } from './metro-port.js';
import { getAdditionalCliArgs } from './cli-args.js';
import {
  logMetroCacheReused,
  logMetroPortFallback,
  logRunnerStarting,
  logRunnerStillWaitingInQueue,
  logRunnerWaitingInQueue,
  logTestEnvironmentReady,
  logTestRunHeader,
} from './logs.js';

const sessionLogger = logger.child('runtime');
const resourceLockManager = createResourceLockManager();

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
  readonly crashMonitor: CrashMonitor;
  runTestFile: (path: string, options: HarnessRunTestsOptions) => Promise<TestSuiteResult>;
  ensureAppReady: (testFilePath: string) => Promise<void>;
  restartApp: (testFilePath?: string) => Promise<void>;
  callHook: HarnessPluginManager<HarnessConfig, HarnessPlatform>['callHook'];
  setRunState: (state: HarnessRunState | null) => void;
  dispose: () => Promise<void>;
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

const waitForAppReady = async (options: {
  metroInstance: MetroInstance;
  serverBridge: BridgeServer;
  platformInstance: HarnessPlatformRunner;
  platformId: string;
  bundleStartTimeout: number;
  readyTimeout: number;
  maxAppRestarts: number;
  testFilePath: string;
  crashMonitor: CrashMonitor;
  signal?: AbortSignal;
  appLaunchOptions?: AppLaunchOptions;
  launchApp?: () => Promise<void>;
}): Promise<void> => {
  const {
    metroInstance,
    serverBridge,
    platformInstance,
    platformId,
    bundleStartTimeout,
    readyTimeout,
    maxAppRestarts,
    testFilePath,
    crashMonitor,
    appLaunchOptions,
    launchApp = () => platformInstance.restartApp(appLaunchOptions),
  } = options;
  const signal = options.signal ?? new AbortController().signal;

  const logWait = (message: string, ...args: unknown[]) =>
    sessionLogger.debug(`waitForAppReady: ${message}`, ...args);

  return await waitForMetroBackedAppReady({
    metro: metroInstance,
    platformId,
    bundleStartTimeout,
    readyTimeout,
    maxAppRestarts,
    signal,
    startAttempt: async () => {
      logWait('launching app for %s', testFilePath);
      await launchApp();
      logWait('launch request completed, waiting for bridge ready');
    },
    waitForReady: async (signal) => {
      logWait('waiting for runtime ready');
      return await Promise.race([
        new Promise<void>((resolve) => {
          const onReady = () => {
            cleanup();
            logWait('runtime ready received');
            resolve();
          };
          const onAbort = () => cleanup();
          const cleanup = () => {
            serverBridge.off('ready', onReady);
            signal.removeEventListener('abort', onAbort);
          };
          serverBridge.on('ready', onReady);
          signal.addEventListener('abort', onAbort, { once: true });
        }),
        waitForAbort(signal),
      ]);
    },
    waitForCrash: async (signal) => {
      const watch = crashMonitor.watch(testFilePath, 'startup');
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
// Session creation
// ---------------------------------------------------------------------------

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

  if (globalConfig.collectCoverage) {
    process.env.RN_HARNESS_COLLECT_COVERAGE = 'true';
    if (harnessConfig.coverage?.root) {
      process.env.RN_HARNESS_COVERAGE_ROOT = harnessConfig.coverage.root;
    }
  }

  if (harnessConfig.disableViewFlattening) {
    process.env.RN_HARNESS_VIEW_FLATTENING = 'false';
  }

  const selectedRunnerName = cliArgs.harnessRunner ?? harnessConfig.defaultRunner;
  if (!selectedRunnerName) throw new NoRunnerSpecifiedError();

  const platform = harnessConfig.runners.find((r) => r.name === selectedRunnerName);
  if (!platform) throw new RunnerNotFoundError(selectedRunnerName);

  if (
    harnessConfig.webSocketPort != null &&
    harnessConfig.webSocketPort !== harnessConfig.metroPort
  ) {
    logger.warn(
      `Config option "webSocketPort" is deprecated and ignored. Harness now uses metroPort (${harnessConfig.metroPort}) for bridge traffic.`
    );
  }

  return { harnessConfig, platform, projectRoot };
};

export const createHarnessSession = async (
  globalConfig: JestConfig.GlobalConfig,
): Promise<HarnessSession> => {
  preRunMessage.remove(process.stderr);

  const { harnessConfig, platform, projectRoot } = await loadConfig(globalConfig);

  sessionLogger.debug(
    'creating session for runner=%s platform=%s',
    platform.name,
    platform.platformId,
  );

  const resourceLockKey = await (platform.getResourceLockKey?.() ?? getDefaultResourceLockKey(platform));
  let didWaitForResourceLock = false;
  let lastStillWaitingLogAt = 0;

  logTestRunHeader(platform);

  const resourceLease = await resourceLockManager.acquire(resourceLockKey, {
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

  try {
    const { config: runtimeConfig, metroPortLease, initialMetroPort, didFallback } =
      await resolveHarnessMetroPort({
        config: harnessConfig,
        platform,
        resourceLockManager,
        signal: new AbortController().signal,
      });

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

    const context: HarnessContext = { platform };

    const serverBridge = await getBridgeServer({
      noServer: true,
      timeout: runtimeConfig.bridgeTimeout,
      context,
    });
    sessionLogger.debug('bridge server initialized on Metro websocket path %s', HARNESS_BRIDGE_PATH);

    let metroInstance: MetroInstance;
    let platformInstance: HarnessPlatformRunner;

    try {
      [metroInstance, platformInstance] = await Promise.all([
        getMetroInstance(
          {
            projectRoot,
            harnessConfig: runtimeConfig,
            websocketEndpoints: {
              [HARNESS_BRIDGE_PATH]: serverBridge.ws as unknown as MetroWebSocketEndpoint,
            },
          },
          new AbortController().signal,
        ).then((instance) => {
          sessionLogger.debug('Metro initialized');
          return instance;
        }),
        withPlatformReadyTimeout({
          timeout: runtimeConfig.platformReadyTimeout,
          signal: new AbortController().signal,
          work: async () => {
            return await import(platform.runner).then((module) =>
              module.default(platform.config, runtimeConfig, {
                signal: new AbortController().signal,
              } satisfies HarnessPlatformInitOptions),
            ).then((instance) => {
              sessionLogger.debug('platform runner initialized');
              return instance;
            });
          },
        }),
      ]);
    } catch (error) {
      await Promise.allSettled([
        resourceLease.release(),
        metroPortLease?.release(),
        serverBridge.dispose(),
      ]);
      throw error;
    }

    const crashArtifactWriter = createCrashArtifactWriter({
      runnerName: platform.name,
      platformId: platform.platformId,
    });
    const appMonitor = platformInstance.createAppMonitor({ crashArtifactWriter });
    const appLaunchOptions = (platform.config as { appLaunchOptions?: AppLaunchOptions }).appLaunchOptions;

    const crashMonitor = createCrashMonitor({ appMonitor, platformRunner: platformInstance });

    // --- Event listeners ---

    const bridgeEventListener = buildBridgeHookScheduler(hooks, pluginManager, getCurrentRunId);

    const onMetroEvent = (event: ReportableEvent) => {
      const runId = getCurrentRunId();
      if (runId && event.type === 'client_log') {
        hooks.schedule(() => pluginManager.callHook('metro:client-log', { runId, level: event.level, data: event.data }));
      }
    };

    const clientLogListener = createClientLogListener();

    const onReady = (device: DeviceDescriptor) => {
      const runId = getCurrentRunId();
      if (!runId) return;
      hooks.schedule(() => pluginManager.callHook('runtime:ready', { runId, device }));
    };

    const onDisconnect = () => {
      const runId = getCurrentRunId();
      if (!runId) return;
      hooks.schedule(() => pluginManager.callHook('runtime:disconnected', { runId, reason: 'bridge-disconnected' }));
    };

    serverBridge.on('ready', onReady);
    serverBridge.on('disconnect', onDisconnect);
    serverBridge.on('event', bridgeEventListener);
    metroInstance.events.addListener(onMetroEvent);
    if (runtimeConfig.forwardClientLogs) {
      metroInstance.events.addListener(clientLogListener);
    }

    sessionLogger.debug('registered runtime, bridge, and Metro listeners');

    // --- Dispose ---

    let disposePromise: Promise<void> | null = null;

    const disposeOnce = async () => {
      sessionLogger.debug('disposing session');

      const reason = 'normal';
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
      serverBridge.off('ready', onReady);
      serverBridge.off('disconnect', onDisconnect);
      serverBridge.off('event', bridgeEventListener);

      let cleanupError: unknown;
      try {
        await Promise.all([
          crashMonitor.dispose(),
          serverBridge.dispose(),
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

    const dispose = () => {
      disposePromise ??= disposeOnce();
      return disposePromise;
    };

    // Register signal handlers so dispose actually runs on process exit
    const onSignal = () => {
      void dispose().then(() => process.exit(0));
    };
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
      await dispose();
      throw error;
    }

    logTestEnvironmentReady(platform);
    sessionLogger.debug('session ready');

    // --- Public API ---

    const ensureAppReady = async (testFilePath: string): Promise<void> => {
      await hooks.drain();
      sessionLogger.debug('ensuring app is ready for %s', testFilePath);

      if (crashMonitor.isAlive() && await platformInstance.isAppRunning()) {
        sessionLogger.debug('reusing existing ready app for %s', testFilePath);
        return;
      }

      crashMonitor.reset();
      sessionLogger.debug('app not ready, waiting for launch and runtime readiness');

      await waitForAppReady({
        metroInstance,
        serverBridge,
        platformInstance,
        platformId: platform.platformId,
        bundleStartTimeout: runtimeConfig.bundleStartTimeout ?? 60000,
        readyTimeout: runtimeConfig.bridgeTimeout,
        maxAppRestarts: runtimeConfig.maxAppRestarts ?? 2,
        testFilePath,
        crashMonitor,
        appLaunchOptions,
      });

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
      const client = serverBridge.rpc.clients.at(-1);
      if (!client) throw new Error('No client found');
      sessionLogger.debug('running test file on client: %s', testPath);
      const result = await client.runTests(testPath, { ...options, runner: platform.runner });
      await hooks.drain();
      return result;
    };

    return {
      config: runtimeConfig,
      context,
      crashMonitor,
      runTestFile,
      ensureAppReady,
      restartApp,
      callHook: async (name, payload) => {
        await hooks.drain();
        await pluginManager.callHook(name, payload);
        await hooks.drain();
      },
      setRunState: (state) => {
        currentRun = state;
      },
      dispose: () => {
        process.off('SIGTERM', onSignal);
        process.off('SIGINT', onSignal);
        return dispose();
      },
    };
  } catch (error) {
    await resourceLease.release();
    throw error;
  }
};
