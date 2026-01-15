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
  port: number,
  hostPort: number = port
): Promise<void> => {
  await spawn('adb', [
    '-s',
    adbId,
    'reverse',
    `tcp:${port}`,
    `tcp:${hostPort}`,
  ]);
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
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.LAUNCHER',
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

export const isAppRunning = async (
  adbId: string,
  bundleId: string
): Promise<boolean> => {
  const { stdout } = await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'pidof',
    bundleId,
  ]);
  return stdout.trim() !== '';
};

export const getUiHierarchy = async (adbId: string): Promise<string> => {
  const dumpPath = '/data/local/tmp/uidump.xml';
  await spawn('adb', ['-s', adbId, 'shell', 'uiautomator', 'dump', dumpPath]);
  const { stdout } = await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'cat',
    dumpPath,
  ]);
  await spawn('adb', ['-s', adbId, 'shell', 'rm', dumpPath]);
  return stdout;
};

export const tap = async (
  adbId: string,
  x: number,
  y: number
): Promise<void> => {
  await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'input',
    'tap',
    x.toString(),
    y.toString(),
  ]);
};

export const inputText = async (adbId: string, text: string): Promise<void> => {
  // ADB input text requires spaces to be escaped as %s
  const escapedText = text.replace(/ /g, '%s');
  await spawn('adb', ['-s', adbId, 'shell', 'input', 'text', escapedText]);
};

export const screenshot = async (
  adbId: string,
  destination: string
): Promise<string> => {
  const deviceTempPath = '/data/local/tmp/screenshot.png';
  await spawn('adb', ['-s', adbId, 'shell', 'screencap', '-p', deviceTempPath]);
  await spawn('adb', ['-s', adbId, 'pull', deviceTempPath, destination]);
  await spawn('adb', ['-s', adbId, 'shell', 'rm', deviceTempPath]);
  return destination;
};
