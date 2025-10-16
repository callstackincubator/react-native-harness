import { TestRunnerConfig } from '@react-native-harness/config';
import { Environment } from './platforms/platform-adapter.js';
import {
  BridgeServer,
  getBridgeServer,
} from '@react-native-harness/bridge/server';
import { BridgeTimeoutError } from './errors/errors.js';
import { getPlatformAdapter } from './platforms/platform-registry.js';

export type Harness = {
  environment: Environment;
  bridge: BridgeServer;
};

export const getHarness = async (
  runner: TestRunnerConfig
): Promise<Harness> => {
  const bridgeTimeout = 60000;
  const platformAdapter = await getPlatformAdapter(runner.platform);
  const serverBridge = await getBridgeServer({
    port: 3001,
  });

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new BridgeTimeoutError(bridgeTimeout, runner.name, runner.platform)
      );
    }, bridgeTimeout);

    serverBridge.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  const environment = await platformAdapter.getEnvironment(runner);
  await readyPromise;

  return {
    environment,
    bridge: serverBridge,
  };
};
