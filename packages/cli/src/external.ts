import { getBridgeServer } from '@react-native-harness/bridge/server';
import { BridgeClientFunctions } from '@react-native-harness/bridge';
import { HarnessPlatform } from '@react-native-harness/platforms';
import { getMetroInstance } from '@react-native-harness/bundler-metro';

export type Harness = {
  runTests: BridgeClientFunctions['runTests'];
  restart: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const getHarness = async (
  platform: HarnessPlatform
): Promise<Harness> => {
  const [metroInstance, platformInstance, serverBridge] = await Promise.all([
    getMetroInstance(),
    platform.getInstance(),
    getBridgeServer({
      port: 3001,
    }),
  ]);

  return {
    runTests: async (path, options) => {
      const client = serverBridge.rpc.clients.at(-1);

      if (!client) {
        throw new Error('No client found');
      }

      return await client.runTests(path, options);
    },
    restart: () => {
      return new Promise<void>((resolve, reject) => {
        serverBridge.once('ready', () => resolve());
        platformInstance.restartApp().catch(reject);
      });
    },
    dispose: async () => {
      await Promise.all([
        serverBridge.dispose(),
        platformInstance.dispose(),
        metroInstance.dispose(),
      ]);
    },
  };
};
