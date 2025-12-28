import { getBridgeServer } from '@react-native-harness/bridge/server';
import { BridgeClientFunctions } from '@react-native-harness/bridge';
import { HarnessPlatform } from '@react-native-harness/platforms';
import { getMetroInstance } from '@react-native-harness/bundler-metro';
import { InitializationTimeoutError } from './errors.js';
import { Config as HarnessConfig } from '@react-native-harness/config';
import pRetry from 'p-retry';

const BRIDGE_READY_TIMEOUT = 10000;

export type Harness = {
  runTests: BridgeClientFunctions['runTests'];
  restart: () => Promise<void>;
  dispose: () => Promise<void>;
};

const getHarnessInternal = async (
  config: HarnessConfig,
  platform: HarnessPlatform,
  projectRoot: string,
  signal: AbortSignal
): Promise<Harness> => {
  const [metroInstance, platformInstance, serverBridge] = await Promise.all([
    getMetroInstance({ projectRoot, harnessConfig: config }, signal),
    import(platform.runner).then((module) =>
      module.default(platform.config, config)
    ),
    getBridgeServer({
      port: config.webSocketPort,
      timeout: config.bridgeTimeout,
    }),
  ]);

  const dispose = async () => {
    await Promise.all([
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
    await pRetry(
      () =>
        new Promise<void>((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });

          serverBridge.once('ready', () => resolve());
          platformInstance.restartApp().catch(reject);
        }),
      {
        minTimeout: BRIDGE_READY_TIMEOUT,
        maxTimeout: BRIDGE_READY_TIMEOUT,
        retries: Infinity,
        signal,
      }
    );
  } catch (error) {
    await dispose();
    throw error;
  }

  const restart = () =>
    new Promise<void>((resolve, reject) => {
      serverBridge.once('ready', () => resolve());
      platformInstance.restartApp().catch(reject);
    });

  return {
    runTests: async (path, options) => {
      const client = serverBridge.rpc.clients.at(-1);

      if (!client) {
        throw new Error('No client found');
      }

      return await client.runTests(path, options);
    },
    restart,
    dispose,
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
