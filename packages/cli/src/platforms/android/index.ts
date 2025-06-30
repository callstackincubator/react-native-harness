import { type ChildProcess } from 'node:child_process';
import { getInteractionEngine } from '@react-native-harness/interaction-engine';
import { TestRunnerConfig } from '@react-native-harness/config';

import { type PlatformAdapter } from '../platform-adapter.js';
import {
  runEmulator,
  getEmulatorDeviceId,
  reversePort,
  isAppInstalled,
  getEmulatorStatus,
} from './emulator.js';
import { runApp, killApp } from './build.js';
import { killWithAwait } from '../../process.js';
import { runMetro } from '../../bundlers/metro.js';
import { AppNotInstalledError } from '../../errors/appNotInstalledError.js';

const androidPlatformAdapter: PlatformAdapter = {
  name: 'android',
  getEnvironment: async (runner: TestRunnerConfig) => {
    let emulator: ChildProcess | null = null;
    const emulatorStatus = await getEmulatorStatus(runner.deviceId);

    const metroPromise = runMetro();

    if (emulatorStatus === 'stopped') {
      emulator = await runEmulator(runner.deviceId);
    }

    const interactionEnginePromise = getInteractionEngine(runner);

    const deviceId = await getEmulatorDeviceId(runner.deviceId);

    if (!deviceId) {
      throw new Error('Emulator not found');
    }

    await Promise.all([
      reversePort(8081),
      reversePort(8080),
      reversePort(3001),
    ]);

    const isInstalled = await isAppInstalled(deviceId, runner.bundleId);

    if (!isInstalled) {
      throw new AppNotInstalledError(runner.deviceId, runner.bundleId, 'android');
    }

    const metro = await metroPromise;
    await runApp(deviceId, runner.bundleId);
    const interactionEngine = await interactionEnginePromise;

    return {
      restart: async () => {
        await runApp(runner.deviceId, runner.bundleId);
      },
      dispose: async () => {
        await killApp(deviceId, runner.bundleId);

        if (emulator) {
          await killWithAwait(emulator);
        }

        await interactionEngine.close();
        await killWithAwait(metro);
      },
      interactionEngine,
    };
  },
};

export default androidPlatformAdapter;
