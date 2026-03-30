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
  waitForMetroBackedAppReady,
  type MetroInstance,
} from '@react-native-harness/bundler-metro';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import {
  InitializationTimeoutError,
} from './errors.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import {
  createCrashSupervisor,
  type CrashSupervisor,
} from './crash-supervisor.js';
import { createClientLogListener } from './client-log-handler.js';
import { logMetroCacheReused } from './logs.js';

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
