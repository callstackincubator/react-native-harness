import {
  getBridgeServer,
  BridgeServer,
} from '@react-native-harness/bridge/server';
import {
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
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import {
  getMetroInstance,
  isMetroCacheReusable,
  prewarmMetroBundle,
  type Reporter,
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
import { logger, createCrashArtifactWriter } from '@react-native-harness/tools';
import { InitializationTimeoutError, StartupStallError } from './errors.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import {
  createCrashSupervisor,
  type CrashSupervisor,
} from './crash-supervisor.js';
import { createClientLogListener } from './client-log-handler.js';
import { logMetroCacheReused, logMetroPrewarmCompleted } from './logs.js';
import path from 'node:path';

const harnessLogger = logger.child('runtime');

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
  runTests: (
    path: string,
    options: HarnessRunTestsOptions
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
  projectRoot: string
): void => {
  if (
    config.unstable__enableMetroCache &&
    isMetroCacheReusable(projectRoot)
  ) {
    logMetroCacheReused(platform);
  }
};

export const waitForAppReady = async (options: {
  metroEvents: Reporter;
  serverBridge: BridgeServer;
  platformInstance: HarnessPlatformRunner;
  bundleStartTimeout: number;
  maxAppRestarts: number;
  testFilePath: string;
  crashSupervisor: CrashSupervisor;
  appLaunchOptions?: AppLaunchOptions;
  launchApp?: () => Promise<void>;
}): Promise<void> => {
  const {
    metroEvents,
    serverBridge,
    platformInstance,
    bundleStartTimeout,
    maxAppRestarts,
    testFilePath,
    crashSupervisor,
    appLaunchOptions,
    launchApp = () => platformInstance.restartApp(appLaunchOptions),
  } = options;

  const totalAttempts = maxAppRestarts + 1;
  let restartCount = 0;
  let isBundling = false;
  let timeoutId: NodeJS.Timeout | null = null;
  let settled = false;

  const logWait = (message: string, ...args: Array<unknown>) => {
    harnessLogger.debug(`waitForAppReady: ${message}`, ...args);
  };

  const clearStartupTimer = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      settled = true;
      clearStartupTimer();
      metroEvents.removeListener(onMetroEvent);
      serverBridge.off('ready', onReady);
      crashSupervisor.cancelCrashWaiters();
    };

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }

      logWait('failed while waiting for app readiness');
      harnessLogger.debug(error);
      cleanup();
      reject(error);
    };

    const resolveOnce = () => {
      if (settled) {
        return;
      }

      logWait('runtime ready received');
      cleanup();
      resolve();
    };

    const startStartupTimer = () => {
      clearStartupTimer();
      logWait(
        'starting startup timer (%dms) for attempt %d/%d',
        bundleStartTimeout,
        restartCount + 1,
        totalAttempts
      );
      timeoutId = setTimeout(() => {
        if (settled || isBundling) {
          return;
        }

        if (restartCount >= maxAppRestarts) {
          logWait('startup timer expired with no retries remaining');
          rejectOnce(
            new StartupStallError(bundleStartTimeout, totalAttempts)
          );
          return;
        }

        restartCount += 1;
        logWait(
          'startup timer expired, retrying launch (%d/%d)',
          restartCount + 1,
          totalAttempts
        );
        void startAttempt();
      }, bundleStartTimeout);
    };

    const onReady = () => {
      if (settled) {
        return;
      }

      crashSupervisor.markReady();
      resolveOnce();
    };

    const onMetroEvent = (event: ReportableEvent) => {
      if (event.type === 'bundle_build_started') {
        isBundling = true;
        clearStartupTimer();
        logWait('bundle started, pausing startup timer');
        return;
      }

      if (
        event.type === 'bundle_build_done' ||
        event.type === 'bundle_build_failed'
      ) {
        isBundling = false;

        if (!settled && !crashSupervisor.isReady()) {
          // Keep the historical behavior: once bundling settles, give RN a fresh timeout window.
          logWait('bundle settled (%s), waiting for runtime ready', event.type);
          startStartupTimer();
        }
      }
    };

    const startAttempt = async () => {
      if (settled || crashSupervisor.isReady()) {
        resolveOnce();
        return;
      }

      logWait(
        'launch attempt %d/%d for %s',
        restartCount + 1,
        totalAttempts,
        testFilePath
      );
      crashSupervisor.cancelCrashWaiters();
      crashSupervisor.beginLaunch(testFilePath);
      startStartupTimer();
      logWait('waiting for runtime ready');

      void crashSupervisor.waitForCrash(testFilePath).catch((error) => {
        rejectOnce(error);
      });

      try {
        await launchApp();
        logWait('launch request completed, waiting for bridge ready');
      } catch (error) {
        rejectOnce(error);
      }
    };

    metroEvents.addListener(onMetroEvent);
    serverBridge.on('ready', onReady);

    void startAttempt();
  });
};

const getHarnessInternal = async (
  config: HarnessConfig,
  platform: HarnessPlatform,
  projectRoot: string,
  signal: AbortSignal
): Promise<Harness> => {
  const context: HarnessContext = {
    platform,
  };
  harnessLogger.debug(
    'creating Harness internals for runner=%s platform=%s',
    platform.name,
    platform.platformId
  );
  maybeLogMetroCacheReuse(config, platform, projectRoot);
  const pluginAbortController = new AbortController();
  const pluginManager = createHarnessPluginManager<HarnessConfig, HarnessPlatform>({
    plugins: (config.plugins ?? []) as Array<
      HarnessPlugin<object, HarnessConfig, HarnessPlatform>
    >,
    projectRoot,
    config,
    runner: platform,
    abortSignal: pluginAbortController.signal,
  });
  let currentRun: HarnessRunState | null = null;
  let activeTestFilePath: string | undefined;
  const pendingHookPromises = new Set<Promise<void>>();
  let pendingHookError: unknown;

  const getCurrentRunId = () => currentRun?.runId;
  const toRelativeTestFilePath = (testFilePath?: string) =>
    testFilePath == null ? undefined : path.relative(projectRoot, testFilePath);
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
    TName extends keyof FlatHarnessHookContexts<object, HarnessConfig, HarnessPlatform>,
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
    >
  ) => {
    trackHook(pluginManager.callHook(name, payload));
  };

  harnessLogger.debug(
    'starting Metro, platform runner, and bridge initialization'
  );
  const [metroInstance, platformInstance, serverBridge] = await Promise.all([
    getMetroInstance({ projectRoot, harnessConfig: config }, signal).then(
      (instance) => {
        harnessLogger.debug('Metro initialized');
        return instance;
      }
    ),
    import(platform.runner)
      .then((module) => module.default(platform.config, config))
      .then((instance) => {
        harnessLogger.debug('platform runner initialized');
        return instance;
      }),
    getBridgeServer({
      port: config.webSocketPort,
      timeout: config.bridgeTimeout,
      context,
    }).then((bridge) => {
      harnessLogger.debug(
        'bridge server initialized on port %d',
        config.webSocketPort
      );
      return bridge;
    }),
  ]);
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

  if (config.forwardClientLogs) {
    metroInstance.events.addListener(clientLogListener);
    harnessLogger.debug('client log forwarding enabled');
  }

  const dispose = async (reason: 'normal' | 'abort' | 'error' = 'normal') => {
    harnessLogger.debug('disposing Harness (reason=%s)', reason);
    let hookError: unknown;

    try {
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

    if (config.forwardClientLogs) {
      metroInstance.events.removeListener(clientLogListener);
    }
    metroInstance.events.removeListener(onMetroEvent);
    appMonitor.removeListener(onAppMonitorEvent);
    serverBridge.off('ready', onReady);
    serverBridge.off('disconnect', onDisconnect);
    serverBridge.off('event', bridgeEventListener);
    await Promise.all([
      crashSupervisor.dispose(),
      serverBridge.dispose(),
      platformInstance.dispose(),
      metroInstance.dispose(),
    ]);
    pluginAbortController.abort();
    harnessLogger.debug('Harness resources disposed');

    if (hookError) {
      throw hookError;
    }
  };

  if (signal.aborted) {
    await dispose('abort');

    throw new DOMException('The operation was aborted', 'AbortError');
  }

  try {
    await pluginManager.callHook('harness:before-creation', {
      appLaunchOptions,
    });
    harnessLogger.debug('starting Metro prewarm');
    await prewarmMetroBundle({
      projectRoot,
      entryPoint: config.entryPoint,
      port: config.metroPort,
      platform: platform.platformId,
      dev: true,
      minify: false,
      signal,
    });
    logMetroPrewarmCompleted(platform);
    harnessLogger.debug('Metro prewarm completed');
    await appMonitor.start();
    harnessLogger.debug('app monitor started');
  } catch (error) {
    const runState = currentRun as HarnessRunState | null;

    if (runState) {
      runState.error = error;
      currentRun = runState;
    }
    await dispose(error instanceof DOMException && error.name === 'AbortError' ? 'abort' : 'error');
    throw error;
  }

  const ensureAppReady = async (testFilePath: string) => {
    await flushPendingHooks();
    setActiveTestFilePath(testFilePath);
    crashSupervisor.setActiveTestFile(testFilePath);
    harnessLogger.debug('ensuring app is ready for %s', testFilePath);

    if (crashSupervisor.isReady() && (await platformInstance.isAppRunning())) {
      harnessLogger.debug('reusing existing ready app for %s', testFilePath);
      return;
    }

    crashSupervisor.reset();
    harnessLogger.debug('app not ready, waiting for launch and runtime readiness');
    await waitForAppReady({
      metroEvents: metroInstance.events,
      serverBridge,
      platformInstance: platformInstance as HarnessPlatformRunner,
      bundleStartTimeout: config.bundleStartTimeout ?? 15000,
      maxAppRestarts: config.maxAppRestarts ?? 2,
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
      testFilePath ? 'stop-and-ensure-ready' : 'direct-restart'
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
};

export const getHarness = async (
  config: HarnessConfig,
  platform: HarnessPlatform,
  projectRoot: string
): Promise<Harness> => {
  const abortSignal = AbortSignal.timeout(config.bridgeTimeout);
  harnessLogger.debug(
    'creating Harness with bridge timeout %dms',
    config.bridgeTimeout
  );

  try {
    const harness = await getHarnessInternal(
      config,
      platform,
      projectRoot,
      abortSignal
    );
    return harness;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new InitializationTimeoutError();
    }

    throw error;
  }
};
