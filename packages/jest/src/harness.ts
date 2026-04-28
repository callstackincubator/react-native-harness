import {
  getBridgeServer,
  BridgeServer,
} from '@react-native-harness/bridge/server';
import {
  HARNESS_BRIDGE_PATH,
  HarnessContext,
  type BridgeEvents,
  type DeviceDescriptor,
  TestExecutionOptions,
  TestSuiteResult,
} from '@react-native-harness/bridge';
import {
  type AppMonitorEvent,
  type AppLaunchOptions,
  HarnessPlatform,
  type HarnessPlatformInitOptions,
  HarnessPlatformRunner,
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
import { PlatformReadyTimeoutError } from './errors.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import {
  createCrashSupervisor,
  type CrashSupervisor,
} from './crash-supervisor.js';
import { createClientLogListener } from './client-log-handler.js';
import path from 'node:path';
import {
  logMetroCacheReused,
  logMetroPortFallback,
  logRunnerStarting,
  logRunnerStillWaitingInQueue,
  logRunnerWaitingInQueue,
} from './logs.js';
import { createResourceLockManager } from './resource-lock.js';
import { resolveHarnessMetroPort } from './metro-port.js';

const harnessLogger = logger.child('runtime');
const resourceLockManager = createResourceLockManager();

export type HarnessRunTestsOptions = Exclude<TestExecutionOptions, 'platform'>;

export type HarnessRunState = {
  runId: string;
  startTime: number;
  testFiles: string[];
  watchMode: boolean;
  coverageEnabled: boolean;
  summary?: HarnessRunSummary;
  status?: HarnessRunStatus;
  error?: unknown;
};

export type Harness = {
  context: HarnessContext;
  config: HarnessConfig;
  runTests: (
    path: string,
    options: HarnessRunTestsOptions,
  ) => Promise<TestSuiteResult>;
  ensureAppReady: (testFilePath: string) => Promise<void>;
  restart: (testFilePath?: string) => Promise<void>;
  dispose: () => Promise<void>;
  crashSupervisor: CrashSupervisor;
  callHook: HarnessPluginManager<HarnessConfig, HarnessPlatform>['callHook'];
  setRunState: (runState: HarnessRunState | null) => void;
  getRunState: () => HarnessRunState | null;
};

export const maybeLogMetroCacheReuse = (
  config: HarnessConfig,
  platform: HarnessPlatform,
  projectRoot: string,
): void => {
  if (config.unstable__enableMetroCache && isMetroCacheReusable(projectRoot)) {
    logMetroCacheReused(platform);
  }
};

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

const getDefaultResourceLockKey = (platform: HarnessPlatform): string =>
  `${platform.platformId}:${platform.name}`;

const waitForAbort = (signal: AbortSignal): Promise<never> => {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? createAbortError());
  }

  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason ?? createAbortError());
      },
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

export const waitForAppReady = async (options: {
  metroInstance: MetroInstance;
  serverBridge: BridgeServer;
  platformInstance: HarnessPlatformRunner;
  platformId: string;
  bundleStartTimeout: number;
  readyTimeout: number;
  maxAppRestarts: number;
  testFilePath: string;
  crashSupervisor: CrashSupervisor;
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
    crashSupervisor,
    appLaunchOptions,
    launchApp = () => platformInstance.restartApp(appLaunchOptions),
  } = options;
  const signal = options.signal ?? new AbortController().signal;

  const logWait = (message: string, ...args: Array<unknown>) => {
    harnessLogger.debug(`waitForAppReady: ${message}`, ...args);
  };
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
            crashSupervisor.markReady();
            logWait('runtime ready received');
            resolve();
          };
          const onAbort = () => {
            cleanup();
          };
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
      try {
        logWait('waiting for crash or runtime ready');
        return await Promise.race([
          crashSupervisor.waitForCrash(testFilePath),
          waitForAbort(signal),
        ]);
      } finally {
        crashSupervisor.cancelCrashWaiters();
      }
    },
    onAttemptStart: () => {
      logWait('beginning launch attempt for %s', testFilePath);
      crashSupervisor.beginLaunch(testFilePath);
    },
    onAttemptReset: () => {
      logWait('resetting launch attempt state');
      crashSupervisor.cancelCrashWaiters();
    },
  });
};

const getHarnessInternal = async (
  config: HarnessConfig,
  platform: HarnessPlatform,
  projectRoot: string,
  signal: AbortSignal,
): Promise<Harness> => {
  const context: HarnessContext = {
    platform,
  };
  harnessLogger.debug(
    'creating Harness internals for runner=%s platform=%s',
    platform.name,
    platform.platformId,
  );
  const resourceLockKey = await (platform.getResourceLockKey?.() ??
    getDefaultResourceLockKey(platform));
  let didWaitForResourceLock = false;
  let lastStillWaitingLogAt = 0;
  const resourceLease = await resourceLockManager.acquire(resourceLockKey, {
    signal,
    onWait: () => {
      didWaitForResourceLock = true;
      logRunnerWaitingInQueue(platform);
      harnessLogger.debug(
        'waiting in queue for runner=%s key=%s',
        platform.name,
        resourceLockKey,
      );
    },
    onStillWaiting: (elapsedMs) => {
      if (elapsedMs - lastStillWaitingLogAt < 5000) {
        return;
      }

      lastStillWaitingLogAt = elapsedMs;
      logRunnerStillWaitingInQueue(platform);
      harnessLogger.debug(
        'still waiting in queue for runner=%s key=%s elapsedMs=%d',
        platform.name,
        resourceLockKey,
        elapsedMs,
      );
    },
  });
  if (didWaitForResourceLock) {
    logRunnerStarting(platform);
  }
  harnessLogger.debug(
    'resource lock acquired for runner=%s key=%s',
    platform.name,
    resourceLockKey,
  );
  try {
    const {
      config: runtimeConfig,
      metroPortLease,
      initialMetroPort,
      didFallback,
    } = await resolveHarnessMetroPort({
      config,
      platform,
      resourceLockManager,
      signal,
    });

    if (didFallback) {
      logMetroPortFallback(initialMetroPort, runtimeConfig.metroPort);
    }

    maybeLogMetroCacheReuse(runtimeConfig, platform, projectRoot);
    const pluginAbortController = new AbortController();
    const pluginManager = createHarnessPluginManager<
      HarnessConfig,
      HarnessPlatform
    >({
      plugins: (runtimeConfig.plugins ?? []) as Array<
        HarnessPlugin<object, HarnessConfig, HarnessPlatform>
      >,
      projectRoot,
      config: runtimeConfig,
      runner: platform,
      abortSignal: pluginAbortController.signal,
    });
    let currentRun: HarnessRunState | null = null;
    let activeTestFilePath: string | undefined;
    const pendingHookPromises = new Set<Promise<void>>();
    let pendingHookError: unknown;
    const getCurrentRunId = () => currentRun?.runId;
    const toRelativeTestFilePath = (testFilePath?: string) =>
      testFilePath == null
        ? undefined
        : path.relative(projectRoot, testFilePath);
    const setActiveTestFilePath = (testFilePath?: string) => {
      activeTestFilePath = toRelativeTestFilePath(testFilePath);
    };
    const flushPendingHooks = async () => {
      if (pendingHookPromises.size > 0) {
        await Promise.allSettled([...pendingHookPromises]);
      }

      if (pendingHookError !== undefined) {
        const error = pendingHookError;
        pendingHookError = undefined;
        throw error;
      }
    };
    const trackHook = (promise: Promise<void>) => {
      const trackedPromise = promise
        .catch((error) => {
          pendingHookError ??= error;
        })
        .finally(() => {
          pendingHookPromises.delete(trackedPromise);
        });

      pendingHookPromises.add(trackedPromise);
    };
    const scheduleHook = <
      TName extends keyof FlatHarnessHookContexts<
        object,
        HarnessConfig,
        HarnessPlatform
      >,
    >(
      name: TName,
      payload: Omit<
        FlatHarnessHookContexts<object, HarnessConfig, HarnessPlatform>[TName],
        | 'plugin'
        | 'logger'
        | 'projectRoot'
        | 'config'
        | 'runner'
        | 'platform'
        | 'state'
        | 'timestamp'
        | 'abortSignal'
        | 'meta'
      >,
    ) => {
      trackHook(pluginManager.callHook(name, payload));
    };

    const serverBridge = await getBridgeServer({
      noServer: true,
      timeout: runtimeConfig.bridgeTimeout,
      context,
    });
    harnessLogger.debug(
      'starting Metro, platform runner, and bridge initialization',
    );
    harnessLogger.debug(
      'bridge server initialized on Metro websocket path %s',
      HARNESS_BRIDGE_PATH,
    );
    const [metroInstance, platformInstance] = await (async () => {
      try {
        return await Promise.all([
          getMetroInstance(
            {
              projectRoot,
              harnessConfig: runtimeConfig,
              websocketEndpoints: {
                [HARNESS_BRIDGE_PATH]:
                  serverBridge.ws as unknown as MetroWebSocketEndpoint,
              },
            },
            signal,
          ).then((instance) => {
            harnessLogger.debug('Metro initialized');
            return instance;
          }),
          withPlatformReadyTimeout({
            timeout: runtimeConfig.platformReadyTimeout,
            signal,
            work: async () => {
              return await import(platform.runner)
                .then((module) =>
                  module.default(platform.config, runtimeConfig, {
                    signal,
                  } satisfies HarnessPlatformInitOptions),
                )
                .then((instance) => {
                  harnessLogger.debug('platform runner initialized');
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
    })();
    const crashArtifactWriter = createCrashArtifactWriter({
      runnerName: platform.name,
      platformId: platform.platformId,
    });
    const appMonitor = platformInstance.createAppMonitor({
      crashArtifactWriter,
    });
    const appLaunchOptions = (
      platform.config as { appLaunchOptions?: AppLaunchOptions }
    ).appLaunchOptions;

    const clientLogListener = createClientLogListener();
    const bridgeEventListener = (event: BridgeEvents) => {
      const runId = getCurrentRunId();
      if (!runId) {
        return;
      }

      switch (event.type) {
        case 'collection-started':
          scheduleHook('collection:started', {
            runId,
            file: event.file,
          });
          break;
        case 'collection-finished':
          scheduleHook('collection:finished', {
            runId,
            file: event.file,
            duration: event.duration,
            totalTests: event.totalTests,
          });
          break;
        case 'suite-started':
          scheduleHook('suite:started', {
            runId,
            file: event.file,
            name: event.name,
          });
          break;
        case 'suite-finished':
          scheduleHook('suite:finished', {
            runId,
            file: event.file,
            name: event.name,
            duration: event.duration,
            status: event.status,
            error: event.error,
          });
          break;
        case 'test-started':
          scheduleHook('test:started', {
            runId,
            file: event.file,
            suite: event.suite,
            name: event.name,
          });
          break;
        case 'test-finished':
          scheduleHook('test:finished', {
            runId,
            file: event.file,
            suite: event.suite,
            name: event.name,
            duration: event.duration,
            status: event.status,
            error: event.error,
          });
          break;
        case 'module-bundling-started':
          scheduleHook('metro:bundle-started', {
            runId,
            target: 'module',
            file: event.file,
          });
          break;
        case 'module-bundling-finished':
          scheduleHook('metro:bundle-finished', {
            runId,
            target: 'module',
            file: event.file,
            duration: event.duration,
          });
          break;
        case 'module-bundling-failed':
          scheduleHook('metro:bundle-failed', {
            runId,
            target: 'module',
            file: event.file,
            duration: event.duration,
            error: event.error,
          });
          break;
        case 'setup-file-bundling-started':
          scheduleHook('metro:bundle-started', {
            runId,
            target: 'setupFile',
            file: event.file,
            setupType: event.setupType,
          });
          break;
        case 'setup-file-bundling-finished':
          scheduleHook('metro:bundle-finished', {
            runId,
            target: 'setupFile',
            file: event.file,
            setupType: event.setupType,
            duration: event.duration,
          });
          break;
        case 'setup-file-bundling-failed':
          scheduleHook('metro:bundle-failed', {
            runId,
            target: 'setupFile',
            file: event.file,
            setupType: event.setupType,
            duration: event.duration,
            error: event.error,
          });
          break;
      }
    };
    const onMetroEvent = (event: ReportableEvent) => {
      const runId = getCurrentRunId();

      if (runId && event.type === 'client_log') {
        scheduleHook('metro:client-log', {
          runId,
          level: event.level,
          data: event.data,
        });
      }
    };
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: platformInstance,
    });

    const onReady = (device: DeviceDescriptor) => {
      crashSupervisor.markReady();

      const runId = getCurrentRunId();
      if (!runId) {
        return;
      }

      scheduleHook('runtime:ready', {
        runId,
        device,
      });
    };
    const onDisconnect = () => {
      const runId = getCurrentRunId();
      if (!runId) {
        return;
      }

      scheduleHook('runtime:disconnected', {
        runId,
        reason: 'bridge-disconnected',
      });
    };
    const onAppMonitorEvent = (event: AppMonitorEvent) => {
      const runId = getCurrentRunId();
      if (!runId) {
        return;
      }

      if (event.type === 'app_started') {
        scheduleHook('app:started', {
          runId,
          testFile: activeTestFilePath,
          pid: event.pid,
          source: event.source,
          line: event.line,
        });
        return;
      }

      if (event.type === 'app_exited') {
        scheduleHook('app:exited', {
          runId,
          testFile: activeTestFilePath,
          pid: event.pid,
          source: event.source,
          line: event.line,
          isConfirmed: event.isConfirmed,
          crashDetails: event.crashDetails,
        });
        return;
      }

      if (event.type === 'possible_crash') {
        scheduleHook('app:possible-crash', {
          runId,
          testFile: activeTestFilePath,
          pid: event.pid,
          source: event.source,
          line: event.line,
          isConfirmed: event.isConfirmed,
          crashDetails: event.crashDetails,
        });
      }
    };

    serverBridge.on('ready', onReady);
    serverBridge.on('disconnect', onDisconnect);
    serverBridge.on('event', bridgeEventListener);
    metroInstance.events.addListener(onMetroEvent);
    appMonitor.addListener(onAppMonitorEvent);
    harnessLogger.debug('registered runtime, bridge, and Metro listeners');

    if (runtimeConfig.forwardClientLogs) {
      metroInstance.events.addListener(clientLogListener);
      harnessLogger.debug('client log forwarding enabled');
    }

    let disposePromise: Promise<void> | null = null;
    const disposeOnce = async (
      reason: 'normal' | 'abort' | 'error' = 'normal'
    ) => {
      harnessLogger.debug('disposing Harness (reason=%s)', reason);
      let hookError: unknown;

      try {
        await flushPendingHooks();
        await pluginManager.callHook('harness:after-run', {
          runId: currentRun?.runId,
          reason,
          summary: currentRun?.summary,
          status: currentRun?.status,
          error: currentRun?.error,
        });
        await flushPendingHooks();
        await pluginManager.callHook('harness:before-dispose', {
          runId: currentRun?.runId,
          reason,
          summary: currentRun?.summary,
          status: currentRun?.status,
          error: currentRun?.error,
        });
        await flushPendingHooks();
      } catch (error) {
        hookError = error;
      }

      if (runtimeConfig.forwardClientLogs) {
        metroInstance.events.removeListener(clientLogListener);
      }
      metroInstance.events.removeListener(onMetroEvent);
      appMonitor.removeListener(onAppMonitorEvent);
      serverBridge.off('ready', onReady);
      serverBridge.off('disconnect', onDisconnect);
      serverBridge.off('event', bridgeEventListener);
      let cleanupError: unknown;
      try {
        await Promise.all([
          crashSupervisor.dispose(),
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
      harnessLogger.debug('Harness resources disposed');

      if (hookError) {
        throw hookError;
      }

      if (cleanupError) {
        throw cleanupError;
      }
    };
    const dispose = (reason: 'normal' | 'abort' | 'error' = 'normal') => {
      disposePromise ??= disposeOnce(reason);
      return disposePromise;
    };

    if (signal.aborted) {
      await dispose('abort');

      throw new DOMException('The operation was aborted', 'AbortError');
    }

    try {
      await pluginManager.callHook('harness:before-creation', {
        appLaunchOptions,
      });
      await flushPendingHooks();
      await appMonitor.start();
      harnessLogger.debug('app monitor started');
      await pluginManager.callHook('harness:before-run', {
        appLaunchOptions,
      });
      await flushPendingHooks();
    } catch (error) {
      const runState = currentRun as HarnessRunState | null;

      if (runState) {
        runState.error = error;
        currentRun = runState;
      }
      await dispose(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'abort'
          : 'error',
      );
      throw error;
    }

    const ensureAppReady = async (testFilePath: string) => {
      await flushPendingHooks();
      setActiveTestFilePath(testFilePath);
      crashSupervisor.setActiveTestFile(testFilePath);
      harnessLogger.debug('ensuring app is ready for %s', testFilePath);

      if (
        crashSupervisor.isReady() &&
        (await platformInstance.isAppRunning())
      ) {
        harnessLogger.debug('reusing existing ready app for %s', testFilePath);
        return;
      }

      crashSupervisor.reset();
      harnessLogger.debug(
        'app not ready, waiting for launch and runtime readiness',
      );
      await waitForAppReady({
        metroInstance,
        serverBridge,
        platformInstance: platformInstance as HarnessPlatformRunner,
        platformId: platform.platformId,
        bundleStartTimeout: runtimeConfig.bundleStartTimeout ?? 60000,
        readyTimeout: runtimeConfig.bridgeTimeout,
        maxAppRestarts: runtimeConfig.maxAppRestarts ?? 2,
        testFilePath,
        crashSupervisor,
        appLaunchOptions,
      });
      await flushPendingHooks();
      harnessLogger.debug('app is ready for %s', testFilePath);
    };

    const restart = async (testFilePath?: string) => {
      await flushPendingHooks();
      await crashSupervisor.stop();
      setActiveTestFilePath(testFilePath);
      harnessLogger.debug(
        'restarting app (testFile=%s mode=%s)',
        testFilePath ?? 'n/a',
        testFilePath ? 'stop-and-ensure-ready' : 'direct-restart',
      );

      if (testFilePath) {
        harnessLogger.debug('stopping app before restart');
        await platformInstance.stopApp();
      } else {
        harnessLogger.debug('requesting direct app restart');
        await platformInstance.restartApp(appLaunchOptions);
      }

      crashSupervisor.reset();
      await crashSupervisor.start();

      if (testFilePath) {
        await ensureAppReady(testFilePath);
      }

      await flushPendingHooks();
      harnessLogger.debug('restart completed');
    };

    return {
      context,
      config: runtimeConfig,
      runTests: async (path, options) => {
        await flushPendingHooks();
        activeTestFilePath = path;
        const client = serverBridge.rpc.clients.at(-1);

        if (!client) {
          throw new Error('No client found');
        }

        harnessLogger.debug('running test file on client: %s', path);
        const result = await client.runTests(path, {
          ...options,
          runner: platform.runner,
        });
        await flushPendingHooks();
        return result;
      },
      ensureAppReady,
      restart,
      dispose: () => dispose('normal'),
      crashSupervisor,
      callHook: async (name, payload) => {
        await flushPendingHooks();
        await pluginManager.callHook(name, payload);
        await flushPendingHooks();
      },
      setRunState: (runState) => {
        currentRun = runState;
      },
      getRunState: () => currentRun,
    };
  } catch (error) {
    await resourceLease.release();
    throw error;
  }
};

export const getHarness = async (
  config: HarnessConfig,
  platform: HarnessPlatform,
  projectRoot: string,
): Promise<Harness> => {
  harnessLogger.debug(
    'creating Harness with platform ready timeout %dms',
    config.platformReadyTimeout,
  );

  return await getHarnessInternal(
    config,
    platform,
    projectRoot,
    new AbortController().signal,
  );
};
