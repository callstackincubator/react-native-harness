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
  prewarmMetroBundle,
} from '@react-native-harness/bundler-metro';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import { InitializationTimeoutError } from './errors.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import {
  createCrashSupervisor,
  type CrashSupervisor,
} from './crash-supervisor.js';
import { createClientLogListener } from './client-log-handler.js';
import { logMetroPrewarmCompleted } from './logs.js';

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

export const waitForAppReady = async (options: {
  serverBridge: BridgeServer;
  platformInstance: HarnessPlatformRunner;
  bridgeTimeout: number;
  testFilePath: string;
  crashSupervisor: CrashSupervisor;
  appLaunchOptions?: AppLaunchOptions;
}): Promise<void> => {
  const {
    serverBridge,
    platformInstance,
    bridgeTimeout,
    testFilePath,
    crashSupervisor,
    appLaunchOptions,
  } = options;

  const signal = AbortSignal.timeout(bridgeTimeout);

  return new Promise<void>((resolve, reject) => {
    const launchApp = async () => {
      crashSupervisor.beginLaunch(testFilePath);
      await platformInstance.restartApp(appLaunchOptions);
    };

    const onReady = () => {
      crashSupervisor.markReady();
      cleanup();
      resolve();
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };

    const cleanup = () => {
      serverBridge.off('ready', onReady);
      signal.removeEventListener('abort', onAbort);
      crashSupervisor.cancelCrashWaiters();
    };

    signal.addEventListener('abort', onAbort);
    serverBridge.once('ready', onReady);
    void crashSupervisor.waitForCrash(testFilePath).catch((error) => {
      cleanup();
      reject(error);
    });

    void launchApp().catch((error) => {
      cleanup();
      reject(error);
    });
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
      serverBridge,
      platformInstance: platformInstance as HarnessPlatformRunner,
      bridgeTimeout: config.bridgeTimeout,
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
