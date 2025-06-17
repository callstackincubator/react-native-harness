import { type ChildProcess } from 'node:child_process';
import { getAppiumInteractionEngine } from '@react-native-harness/interaction-engine';
import { assertNativeRunner, Config } from '@react-native-harness/config';

import { type PlatformAdapter } from '../platform-adapter.js';
import {
  runEmulator,
  getEmulatorDeviceId,
  reversePort,
  isAppInstalled,
  getEmulatorStatus,
} from './emulator.js';
import { buildAndroidApp, runApp, killApp, installApp } from './build.js';
import { killWithAwait } from '../../process.js';
import { runMetro } from '../../bundlers/metro.js';

const androidPlatformAdapter: PlatformAdapter = {
  name: 'android',
  getEnvironment: async (config: Config) => {
    assertNativeRunner(config);

    let emulator: ChildProcess | null = null;
    const emulatorStatus = await getEmulatorStatus(config.runner.deviceId);

    const metroPromise = runMetro();

    if (emulatorStatus === 'stopped') {
      emulator = await runEmulator(config.runner.deviceId);
    }

    const interactionEnginePromise = getAppiumInteractionEngine(config);

    const deviceId = await getEmulatorDeviceId(config.runner.deviceId);

    if (!deviceId) {
      throw new Error('Emulator not found');
    }

    await Promise.all([
      reversePort(8081),
      reversePort(8080),
      reversePort(3001),
    ]);

    const isInstalled = await isAppInstalled(deviceId, config.runner.bundleId);

    if (!isInstalled) {
      await buildAndroidApp();
      await installApp(deviceId);
    }

    const metro = await metroPromise;
    await runApp(deviceId, config.runner.bundleId);

    const interactionEngine = await interactionEnginePromise;

    return {
      restart: async () => {
        await runApp(config.runner.deviceId, config.runner.bundleId);
      },
      dispose: async () => {
        if (emulator) {
          await killWithAwait(emulator);
        }

        await interactionEngine.close();
        metro.kill();
        await killApp(deviceId, config.runner.bundleId);
      },
      interactionEngine,
    };
  },
};

export default androidPlatformAdapter;
