import { getInteractionEngine } from '@react-native-harness/interaction-engine';
import { TestRunnerConfig } from '@react-native-harness/config';
import { type PlatformAdapter } from '../platform-adapter.js';
import { runSimulator } from './simulator.js';
import { isAppInstalled, runApp, killApp } from './build.js';
import { killWithAwait } from '../../process.js';
import { runMetro } from '../../bundlers/metro.js';
import { AppNotInstalledError } from '../../errors/appNotInstalledError.js';

const iosPlatformAdapter: PlatformAdapter = {
  name: 'ios',
  getEnvironment: async (runner: TestRunnerConfig) => {
    const metroPromise = runMetro();
    const interactionEnginePromise = getInteractionEngine(runner);

    await runSimulator(runner.deviceId);

    const isInstalled = await isAppInstalled(
      runner.deviceId,
      runner.bundleId
    );

    if (!isInstalled) {
      throw new AppNotInstalledError(runner.deviceId, runner.bundleId, 'ios');
    }

    const metro = await metroPromise;
    await runApp(runner.deviceId, runner.bundleId);
    const interactionEngine = await interactionEnginePromise;

    return {
      restart: async () => {
        await runApp(runner.deviceId, runner.bundleId);
      },
      dispose: async () => {
        await interactionEngine.close();
        await killWithAwait(metro);
        await killApp(runner.deviceId, runner.bundleId);
      },
      interactionEngine,
    };
  },
};

export default iosPlatformAdapter;
