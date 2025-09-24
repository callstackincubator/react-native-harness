import path from 'node:path';
import { spawn } from '@react-native-harness/tools';

export const buildAndroidApp = async (): Promise<void> => {
  await spawn('react-native', ['build-android', '--tasks', 'assembleDebug']);
};

export const installApp = async (deviceId: string): Promise<void> => {
  await spawn('adb', [
    '-s',
    deviceId,
    'install',
    '-r',
    path.join(
      process.cwd(),
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'debug',
      'app-debug.apk'
    ),
  ]);
};

export const killApp = async (
  deviceId: string,
  bundleId: string
): Promise<void> => {
  await spawn('adb', ['-s', deviceId, 'shell', 'am', 'force-stop', bundleId]);
};

export const runApp = async (
  deviceId: string,
  bundleId: string,
  activityName: string
): Promise<void> => {
  await killApp(deviceId, bundleId);
  await spawn('adb', [
    '-s',
    deviceId,
    'shell',
    'am',
    'start',
    '-n',
    `${bundleId}/${activityName}`,
  ]);
};
