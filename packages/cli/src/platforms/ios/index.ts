import {
  assertNativeRunnerConfig,
  TestRunnerConfig,
} from '@react-native-harness/config';
import { type PlatformAdapter } from '../platform-adapter.js';
import {
  getSimulatorStatus,
  runSimulator,
  stopSimulator,
} from './simulator.js';
import { isAppInstalled, runApp, killApp } from './build.js';
import { killWithAwait } from '../../process.js';
import { runMetro } from '../../bundlers/metro.js';
import { AppNotInstalledError } from '../../errors/errors.js';

const iosPlatformAdapter: PlatformAdapter = {
  name: 'ios',
  getEnvironment: async (runner: TestRunnerConfig) => {
    assertNativeRunnerConfig(runner);

    let shouldStopSimulator = false;
    const simulatorStatus = await getSimulatorStatus(runner.deviceId);
    const metroPromise = runMetro();

    if (simulatorStatus === 'stopped') {
      await runSimulator(runner.deviceId);
      shouldStopSimulator = true;
    }

    const isInstalled = await isAppInstalled(runner.deviceId, runner.bundleId);

    if (!isInstalled) {
      throw new AppNotInstalledError(runner.deviceId, runner.bundleId, 'ios');
    }

    const metro = await metroPromise;
    await runApp(runner.deviceId, runner.bundleId);

    return {
      restart: async () => {
        await runApp(runner.deviceId, runner.bundleId);
      },
      dispose: async () => {
        await killApp(runner.deviceId, runner.bundleId);
        if (shouldStopSimulator) {
          await stopSimulator(runner.deviceId);
        }

        await killWithAwait(metro);
      },
    };
  },
};

export default iosPlatformAdapter;
