import { type ChildProcess } from 'node:child_process';
import {
  assertAndroidRunnerConfig,
  TestRunnerConfig,
} from '@react-native-harness/config';
import { logger } from '@react-native-harness/tools';

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
import { AppNotInstalledError } from '../../errors/errors.js';

const androidPlatformAdapter: PlatformAdapter = {
  name: 'android',
  getEnvironment: async (runner: TestRunnerConfig) => {
    assertAndroidRunnerConfig(runner);

    let emulator: ChildProcess | null = null;
    const emulatorStatus = await getEmulatorStatus(runner.deviceId);
    logger.debug(`Emulator status: ${emulatorStatus}`);

    const metroPromise = runMetro();

    if (emulatorStatus === 'stopped') {
      logger.debug(`Emulator ${runner.deviceId} is stopped, starting it`);
      emulator = await runEmulator(runner.deviceId);
    }

    const deviceId = await getEmulatorDeviceId(runner.deviceId);
    logger.debug(`Device ID: ${deviceId}`);

    if (!deviceId) {
      throw new Error('Emulator not found');
    }

    await Promise.all([
      reversePort(8081),
      reversePort(8080),
      reversePort(3001),
    ]);
    logger.debug('Ports reversed');

    const isInstalled = await isAppInstalled(deviceId, runner.bundleId);
    logger.debug(`App is installed: ${isInstalled}`);

    if (!isInstalled) {
      throw new AppNotInstalledError(
        runner.deviceId,
        runner.bundleId,
        'android'
      );
    }

    logger.debug('Waiting for Metro to start');
    const metro = await metroPromise;
    logger.debug('Metro started');

    logger.debug('Running app');
    await runApp(deviceId, runner.bundleId, runner.activityName);
    logger.debug('App running');

    return {
      restart: async () => {
        await runApp(deviceId, runner.bundleId, runner.activityName);
      },
      dispose: async () => {
        await killApp(deviceId, runner.bundleId);

        if (emulator) {
          await killWithAwait(emulator);
        }

        await killWithAwait(metro);
      },
    };
  },
};

export default androidPlatformAdapter;
