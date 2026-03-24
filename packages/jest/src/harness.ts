import {
  getBridgeServer,
  BridgeServer,
} from '@react-native-harness/bridge/server';
import {
  HarnessContext,
  TestExecutionOptions,
  TestSuiteResult,
} from '@react-native-harness/bridge';
import {
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
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import {
  InitializationTimeoutError,
  StartupStallError,
} from './errors.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import {
  createCrashSupervisor,
  type CrashSupervisor,
} from './crash-supervisor.js';
import { createClientLogListener } from './client-log-handler.js';
import { logMetroCacheReused, logMetroPrewarmCompleted } from './logs.js';

export type HarnessRunTestsOptions = Exclude<TestExecutionOptions, 'platform'>;

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

      cleanup();
      reject(error);
    };

    const resolveOnce = () => {
      if (settled) {
        return;
      }

      cleanup();
      resolve();
    };

    const startStartupTimer = () => {
      clearStartupTimer();
      timeoutId = setTimeout(() => {
        if (settled || isBundling) {
          return;
        }

        if (restartCount >= maxAppRestarts) {
          rejectOnce(
            new StartupStallError(bundleStartTimeout, totalAttempts)
          );
          return;
        }

        restartCount += 1;
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
        return;
      }

      if (
        event.type === 'bundle_build_done' ||
        event.type === 'bundle_build_failed'
      ) {
        isBundling = false;

        if (!settled && !crashSupervisor.isReady()) {
          // Keep the historical behavior: once bundling settles, give RN a fresh timeout window.
          startStartupTimer();
        }
      }
    };

    const startAttempt = async () => {
      if (settled || crashSupervisor.isReady()) {
        resolveOnce();
        return;
      }

      crashSupervisor.cancelCrashWaiters();
      crashSupervisor.beginLaunch(testFilePath);
      startStartupTimer();

      void crashSupervisor.waitForCrash(testFilePath).catch((error) => {
        rejectOnce(error);
      });

      try {
        await launchApp();
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
  maybeLogMetroCacheReuse(config, platform, projectRoot);

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
  const crashSupervisor = createCrashSupervisor({
    appMonitor,
    platformRunner: platformInstance,
  });

  serverBridge.on('ready', crashSupervisor.markReady);

  if (config.forwardClientLogs) {
    metroInstance.events.addListener(clientLogListener);
  }

  const dispose = async () => {
    if (config.forwardClientLogs) {
      metroInstance.events.removeListener(clientLogListener);
    }
    serverBridge.off('ready', crashSupervisor.markReady);
    await Promise.all([
      crashSupervisor.dispose(),
      serverBridge.dispose(),
      platformInstance.dispose(),
      metroInstance.dispose(),
    ]);
  };

  if (signal.aborted) {
    await dispose();

    throw new DOMException('The operation was aborted', 'AbortError');
  }

  try {
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
    await appMonitor.start();
  } catch (error) {
    await dispose();
    throw error;
  }

  const ensureAppReady = async (testFilePath: string) => {
    crashSupervisor.setActiveTestFile(testFilePath);

    if (crashSupervisor.isReady() && (await platformInstance.isAppRunning())) {
      return;
    }

    crashSupervisor.reset();
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
  };

  const restart = async (testFilePath?: string) => {
    await crashSupervisor.stop();

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
  };

  return {
    context,
    runTests: async (path, options) => {
      const client = serverBridge.rpc.clients.at(-1);

      if (!client) {
        throw new Error('No client found');
      }

      return await client.runTests(path, {
        ...options,
        runner: platform.runner,
      });
    },
    ensureAppReady,
    restart,
    dispose,
    crashSupervisor,
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
