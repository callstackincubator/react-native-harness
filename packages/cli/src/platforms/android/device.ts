import { spawn } from '@react-native-harness/tools';

export const killApp = async (
  deviceId: string,
  bundleId: string
): Promise<void> => {
  await spawn('adb', ['-s', deviceId, 'shell', 'am', 'force-stop', bundleId]);
};

export const runApp = async (
  deviceId: string,
  bundleId: string
): Promise<void> => {
  await killApp(deviceId, bundleId);
  await spawn('adb', [
    '-s',
    deviceId,
    'shell',
    'am',
    'start',
    '-n',
    `${bundleId}/.MainActivity`,
  ]);
};

export const isAppInstalled = async (
  deviceId: string,
  bundleId: string
): Promise<boolean> => {
  try {
    const { stdout } = await spawn('adb', [
      '-s',
      deviceId,
      'shell',
      'pm',
      'list',
      'packages',
      bundleId,
    ]);
    return stdout.trim() !== '';
  } catch {
    return false;
  }
};

export const reversePort = async (port: number): Promise<void> => {
  await spawn('adb', ['reverse', `tcp:${port}`, `tcp:${port}`]);
};
