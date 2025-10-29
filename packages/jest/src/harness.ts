import { getBridgeServer } from '@react-native-harness/bridge/server';
import { BridgeClientFunctions } from '@react-native-harness/bridge';
import { HarnessPlatform } from '@react-native-harness/platforms';
import { getMetroInstance } from '@react-native-harness/bundler-metro';
import { InitializationTimeoutError } from './errors.js';

export type Harness = {
  runTests: BridgeClientFunctions['runTests'];
  restart: () => Promise<void>;
  dispose: () => Promise<void>;
};

const getHarnessInternal = async (
  platform: HarnessPlatform,
  signal: AbortSignal
): Promise<Harness> => {
  const [metroInstance, platformInstance, serverBridge] = await Promise.all([
    getMetroInstance(),
    platform.getInstance(),
    getBridgeServer({
      port: 3001,
    }),
  ]);

  if (signal.aborted) {
    metroInstance.dispose();
    platformInstance.dispose();
    serverBridge.dispose();
    signal.throwIfAborted();
  }

  const restart = () =>
    new Promise<void>((resolve, reject) => {
      serverBridge.once('ready', () => resolve());
      platformInstance.restartApp().catch(reject);
    });

  // Wait for the bridge to be ready
  await restart();

  return {
    runTests: async (path, options) => {
      const client = serverBridge.rpc.clients.at(-1);

      if (!client) {
        throw new Error('No client found');
      }

      return await client.runTests(path, options);
    },
    restart,
    dispose: async () => {
      await Promise.all([
        serverBridge.dispose(),
        platformInstance.dispose(),
        metroInstance.dispose(),
      ]);
    },
  };
};

export const getHarness = async (
  platform: HarnessPlatform,
  timeout: number
): Promise<Harness> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeout);
  try {
    const harness = await getHarnessInternal(platform, abortController.signal);
    clearTimeout(timeoutId);
    return harness;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new InitializationTimeoutError();
    }

    throw error;
  }
};
