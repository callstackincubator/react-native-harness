import {
  assertIOSRunnerConfig,
  TestRunnerConfig,
} from '@react-native-harness/config';
import { type PlatformAdapter } from '../platform-adapter.js';
import {
  getSimulatorDeviceId,
  getSimulatorStatus,
  runSimulator,
  stopSimulator,
} from './simulator.js';
import { isAppInstalled, runApp, killApp } from './build.js';
import { killWithAwait } from '../../process.js';
import { runMetro } from '../../bundlers/metro.js';
import { AppNotInstalledError } from '../../errors/errors.js';
import { assert } from '../../utils.js';

const iosPlatformAdapter: PlatformAdapter = {
  name: 'ios',
  getEnvironment: async (runner: TestRunnerConfig) => {
    assertIOSRunnerConfig(runner);
    // TODO: system version is also important as there may be two emulators with the same name
    // but different system versions

    let shouldStopSimulator = false;
    const udid = await getSimulatorDeviceId(
      runner.deviceId,
      runner.systemVersion
    );

    assert(!!udid, 'Simulator not found');

    const simulatorStatus = await getSimulatorStatus(udid);
    const metroPromise = runMetro();

    if (simulatorStatus === 'stopped') {
      await runSimulator(udid);
      shouldStopSimulator = true;
    }

    const isInstalled = await isAppInstalled(udid, runner.bundleId);

    if (!isInstalled) {
      throw new AppNotInstalledError(runner.deviceId, runner.bundleId, 'ios');
    }

    const metro = await metroPromise;
    await runApp(udid, runner.bundleId);

    return {
      restart: async () => {
        await runApp(udid, runner.bundleId);
      },
      dispose: async () => {
        await killApp(udid, runner.bundleId);
        if (shouldStopSimulator) {
          await stopSimulator(udid);
        }

        await killWithAwait(metro);
      },
    };
  },
};

export default iosPlatformAdapter;
