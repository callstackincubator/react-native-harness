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
  HarnessPlatform,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import {
  getMetroInstance,
  Reporter,
  ReportableEvent,
} from '@react-native-harness/bundler-metro';
import { InitializationTimeoutError, MaxAppRestartsError } from './errors.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import { createCrashMonitor, CrashMonitor } from './crash-monitor.js';
import { createClientLogListener } from './client-log-handler.js';

export type HarnessRunTestsOptions = Exclude<TestExecutionOptions, 'platform'>;

export type Harness = {
  context: HarnessContext;
  runTests: (
    path: string,
    options: HarnessRunTestsOptions
  ) => Promise<TestSuiteResult>;
  restart: () => Promise<void>;
  dispose: () => Promise<void>;
  crashMonitor: CrashMonitor;
};

export const waitForAppReady = async (options: {
  metroEvents: Reporter;
  serverBridge: BridgeServer;
  platformInstance: HarnessPlatformRunner;
  bundleStartTimeout: number;
  maxRestarts: number;
  signal: AbortSignal;
}): Promise<void> => {
  const {
    metroEvents,
    serverBridge,
    platformInstance,
    bundleStartTimeout,
    maxRestarts,
    signal,
  } = options;

  let restartCount = 0;
  let isBundling = false;
  let bundleTimeoutId: NodeJS.Timeout | null = null;

  const clearBundleTimeout = () => {
    if (bundleTimeoutId) {
      clearTimeout(bundleTimeoutId);
      bundleTimeoutId = null;
    }
  };

  return new Promise<void>((resolve, reject) => {
    // Handle abort signal
    signal.addEventListener('abort', () => {
      clearBundleTimeout();
      reject(new DOMException('The operation was aborted', 'AbortError'));
    });

    // Start/restart the bundle timeout
    const startBundleTimeout = () => {
      clearBundleTimeout();
      bundleTimeoutId = setTimeout(() => {
        if (isBundling) return; // Don't restart while bundling

        if (restartCount >= maxRestarts) {
          cleanup();
          reject(new MaxAppRestartsError(restartCount + 1));
          return;
        }

        restartCount++;
        platformInstance.restartApp().catch(reject);
        startBundleTimeout(); // Reset timer for next attempt
      }, bundleStartTimeout);
    };

    // Metro event listener
    const onMetroEvent = (event: ReportableEvent) => {
      if (event.type === 'bundle_build_started') {
        isBundling = true;
        clearBundleTimeout(); // Cancel restart timer while bundling
      } else if (
        event.type === 'bundle_build_done' ||
        event.type === 'bundle_build_failed'
      ) {
        isBundling = false;
        startBundleTimeout(); // Reset timer after bundle completes
      }
    };

    // Bridge ready listener
    const onReady = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearBundleTimeout();
      metroEvents.removeListener(onMetroEvent);
      serverBridge.off('ready', onReady);
    };

    // Setup listeners
    metroEvents.addListener(onMetroEvent);
    serverBridge.once('ready', onReady);

    // Start the app and timeout
    platformInstance.restartApp().catch(reject);
    startBundleTimeout();
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

  // Forward client logs to console if enabled
  const clientLogListener = createClientLogListener();

  if (config.forwardClientLogs) {
    metroInstance.events.addListener(clientLogListener);
  }

  const dispose = async () => {
    if (config.forwardClientLogs) {
      metroInstance.events.removeListener(clientLogListener);
    }
    await Promise.all([
      serverBridge.dispose(),
      platformInstance.dispose(),
      metroInstance.dispose(),
    ]);
  };

  const crashMonitor = createCrashMonitor({
    interval: config.crashDetectionInterval,
    platformRunner: platformInstance,
    bridgeServer: serverBridge,
  });

  if (signal.aborted) {
    await dispose();

    throw new DOMException('The operation was aborted', 'AbortError');
  }

  try {
    await waitForAppReady({
      metroEvents: metroInstance.events,
      serverBridge,
      platformInstance: platformInstance as HarnessPlatformRunner,
      bundleStartTimeout: config.bundleStartTimeout,
      maxRestarts: config.maxAppRestarts,
      signal,
    });
  } catch (error) {
    await dispose();
    throw error;
  }

  const restart = () =>
    new Promise<void>((resolve, reject) => {
      crashMonitor.markIntentionalRestart();
      serverBridge.once('ready', () => {
        crashMonitor.clearIntentionalRestart();
        resolve();
      });
      platformInstance.restartApp().catch(reject);
    });

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
    restart,
    dispose,
    crashMonitor,
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
