import { getAppiumInteractionEngine } from '@react-native-harness/interaction-engine';
import { assertNativeRunner, Config } from '@react-native-harness/config';
import { type PlatformAdapter } from '../platform-adapter.js';
import { runSimulator } from './simulator.js';
import { buildIOSApp, isAppInstalled, runApp, killApp } from './build.js';
import { killWithAwait } from '../../process.js';
import { runMetro } from '../../bundlers/metro.js';

const iosPlatformAdapter: PlatformAdapter = {
  name: 'ios',
  getEnvironment: async (config: Config) => {
    assertNativeRunner(config);
    const metroPromise = runMetro();
    const interactionEnginePromise = getAppiumInteractionEngine(config);

    await runSimulator(config.runner.deviceId);

    const isInstalled = await isAppInstalled(
      config.runner.deviceId,
      config.runner.bundleId
    );

    const metro = await metroPromise;

    if (!isInstalled) {
      await buildIOSApp(config.runner.deviceId);
    } else {
      await runApp(config.runner.deviceId, config.runner.bundleId);
    }

    const interactionEngine = await interactionEnginePromise;

    return {
      restart: async () => {
        await runApp(config.runner.deviceId, config.runner.bundleId);
      },
      dispose: async () => {
        await interactionEngine.close();
        await killWithAwait(metro);
        await killApp(config.runner.deviceId, config.runner.bundleId);
      },
      interactionEngine,
    };
  },
};

export default iosPlatformAdapter;
