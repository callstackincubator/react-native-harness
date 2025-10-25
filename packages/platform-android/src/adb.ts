import { spawn } from '@react-native-harness/tools';

export const isAppInstalled = async (
  adbId: string,
  bundleId: string
): Promise<boolean> => {
  const { stdout } = await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'pm',
    'list',
    'packages',
    bundleId,
  ]);
  return stdout.trim() !== '';
};

export const reversePort = async (
  adbId: string,
  port: number
): Promise<void> => {
  await spawn('adb', ['-s', adbId, 'reverse', `tcp:${port}`, `tcp:${port}`]);
};

export const stopApp = async (
  adbId: string,
  bundleId: string
): Promise<void> => {
  await spawn('adb', ['-s', adbId, 'shell', 'am', 'force-stop', bundleId]);
};

export const startApp = async (
  adbId: string,
  bundleId: string,
  activityName: string
): Promise<void> => {
  await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'am',
    'start',
    '-n',
    `${bundleId}/${activityName}`,
  ]);
};

export const getDeviceIds = async (): Promise<string[]> => {
  const { stdout } = await spawn('adb', ['devices']);
  return stdout
    .split('\n')
    .slice(1) // Skip header
    .filter((line) => line.trim() !== '')
    .map((line) => line.split('\t')[0]);
};

export const getEmulatorName = async (
  adbId: string
): Promise<string | null> => {
  const { stdout } = await spawn('adb', ['-s', adbId, 'emu', 'avd', 'name']);
  return stdout.split('\n')[0].trim() || null;
};

export const getShellProperty = async (
  adbId: string,
  property: string
): Promise<string | null> => {
  const { stdout } = await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'getprop',
    property,
  ]);
  return stdout.trim() || null;
};

export type DeviceInfo = {
  manufacturer: string | null;
  model: string | null;
};

export const getDeviceInfo = async (
  adbId: string
): Promise<DeviceInfo | null> => {
  const manufacturer = await getShellProperty(adbId, 'ro.product.manufacturer');
  const model = await getShellProperty(adbId, 'ro.product.model');
  return { manufacturer, model };
};

export const isBootCompleted = async (adbId: string): Promise<boolean> => {
  const bootCompleted = await getShellProperty(adbId, 'sys.boot_completed');
  return bootCompleted === '1';
};

export const stopEmulator = async (adbId: string): Promise<void> => {
  await spawn('adb', ['-s', adbId, 'emu', 'kill']);
};
