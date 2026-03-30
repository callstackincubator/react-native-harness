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
  waitForMetroBackedAppReady,
  type MetroInstance,
  type ReportableEvent,
} from '@react-native-harness/bundler-metro';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import {
  createHarnessPluginManager,
  type FlatHarnessHookContexts,
  type HarnessPlugin,
  type HarnessPluginManager,
  type HarnessRunStatus,
  type HarnessRunSummary,
} from '@react-native-harness/plugins';
import {
  InitializationTimeoutError,
} from './errors.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import {
  createCrashSupervisor,
  type CrashSupervisor,
} from './crash-supervisor.js';
import { createClientLogListener } from './client-log-handler.js';
import path from 'node:path';
import { logMetroCacheReused } from './logs.js';

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

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

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
      { once: true }
    );
  });
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

  return await waitForMetroBackedAppReady({
    metro: metroInstance,
    platformId,
    bundleStartTimeout,
    readyTimeout,
    maxAppRestarts,
    signal,
    startAttempt: async () => {
      await launchApp();
    },
    waitForReady: async (signal) => {
      return await Promise.race([
        new Promise<void>((resolve) => {
          const onReady = () => {
            cleanup();
            crashSupervisor.markReady();
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
        return await Promise.race([
          crashSupervisor.waitForCrash(testFilePath),
          waitForAbort(signal),
        ]);
      } finally {
        crashSupervisor.cancelCrashWaiters();
      }
    },
    onAttemptStart: () => {
      crashSupervisor.beginLaunch(testFilePath);
    },
    onAttemptReset: () => {
      crashSupervisor.cancelCrashWaiters();
    },
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

  const [metroInstance, platformInstance, serverBridge] = await Promise.all([
    getMetroInstance({ projectRoot, harnessConfig: config }, signal),
    import(platform.runner).then((module) =>
      module.default(platform.config, config)
    ),
    getBridgeServer({
      port: config.webSocketPort,
      timeout: config.bridgeTimeout,
      context,
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

  if (config.forwardClientLogs) {
    metroInstance.events.addListener(clientLogListener);
  }

  const dispose = async (reason: 'normal' | 'abort' | 'error' = 'normal') => {
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
    await appMonitor.start();
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

    if (crashSupervisor.isReady() && (await platformInstance.isAppRunning())) {
      return;
    }

    crashSupervisor.reset();
    await waitForAppReady({
      metroInstance,
      serverBridge,
      platformInstance: platformInstance as HarnessPlatformRunner,
      platformId: platform.platformId,
      bundleStartTimeout: config.bundleStartTimeout ?? 60000,
      readyTimeout: config.bridgeTimeout,
      maxAppRestarts: config.maxAppRestarts ?? 2,
      testFilePath,
      crashSupervisor,
      appLaunchOptions,
    });
    await flushPendingHooks();
  };

  const restart = async (testFilePath?: string) => {
    await flushPendingHooks();
    await crashSupervisor.stop();
    setActiveTestFilePath(testFilePath);

    if (testFilePath) {
      await platformInstance.stopApp();
    } else {
      await platformInstance.restartApp(appLaunchOptions);
    }

    crashSupervisor.reset();
    await crashSupervisor.start();

    if (testFilePath) {
      await ensureAppReady(testFilePath);
    }

    await flushPendingHooks();
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
