import { type AndroidAppLaunchOptions } from '@react-native-harness/platforms';
import { spawn, SubprocessError } from '@react-native-harness/tools';

export const getStartAppArgs = (
  bundleId: string,
  activityName: string,
  options?: AndroidAppLaunchOptions
): string[] => {
  const args = [
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.LAUNCHER',
    '-n',
    `${bundleId}/${activityName}`,
  ];

  const extras = options?.extras ?? {};

  for (const [key, value] of Object.entries(extras)) {
    if (typeof value === 'string') {
      args.push('--es', key, value);
      continue;
    }

    if (typeof value === 'boolean') {
      args.push('--ez', key, value ? 'true' : 'false');
      continue;
    }

    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `Android app launch option "${key}" must be a safe integer.`
      );
    }

    args.push('--ei', key, value.toString());
  }

  return args;
};

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
  activityName: string,
  options?: AndroidAppLaunchOptions
): Promise<void> => {
  await spawn('adb', ['-s', adbId, ...getStartAppArgs(bundleId, activityName, options)]);
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
  try {
    const { stdout } = await spawn('adb', [
      '-s',
      adbId,
      'shell',
      'pidof',
      bundleId,
    ]);
    return stdout.trim() !== '';
  } catch (error) {
    if (error instanceof SubprocessError && error.exitCode === 1) {
      return false;
    }

    throw error;
  }
};

export const getAppUid = async (
  adbId: string,
  bundleId: string
): Promise<number> => {
  const { stdout } = await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'pm',
    'list',
    'packages',
    '-U',
  ]);
  const line = stdout
    .split('\n')
    .find((entry) => entry.includes(`package:${bundleId}`));
  const match = line?.match(/\buid:(\d+)\b/);

  if (!match) {
    throw new Error(`Failed to resolve Android app UID for "${bundleId}".`);
  }

  return Number(match[1]);
};

export const setHideErrorDialogs = async (
  adbId: string,
  hide: boolean
): Promise<void> => {
  await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'settings',
    'put',
    'global',
    'hide_error_dialogs',
    hide ? '1' : '0',
  ]);
};

export const getLogcatTimestamp = async (adbId: string): Promise<string> => {
  const { stdout } = await spawn('adb', [
    '-s',
    adbId,
    'shell',
    'date',
    "+'%m-%d %H:%M:%S.000'",
  ]);

  return stdout.trim().replace(/^'+|'+$/g, '');
};

export const getAvds = async (): Promise<string[]> => {
  try {
    const { stdout } = await spawn('emulator', ['-list-avds']);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    return [];
  }
};

export type AdbDevice = {
  id: string;
  model: string;
  manufacturer: string;
};

export const getConnectedDevices = async (): Promise<AdbDevice[]> => {
  const { stdout } = await spawn('adb', ['devices', '-l']);
  const lines = stdout.split('\n').slice(1);
  const devices: AdbDevice[] = [];

  for (const line of lines) {
    if (line.trim() === '') continue;

    const parts = line.split(/\s+/);
    const id = parts[0];

    // If it's an emulator, we skip it here as we handle emulators via AVDs
    if (id.startsWith('emulator-')) continue;

    // Parse model and manufacturer from 'adb devices -l' output
    // Example: 0123456789ABCDEF device usb:337641472X product:sdk_gphone64_arm64 model:Pixel_6 device:oriole transport_id:1
    const modelMatch = line.match(/model:(\S+)/);
    const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : 'Unknown';

    const manufacturer =
      (await getShellProperty(id, 'ro.product.manufacturer')) ?? 'Unknown';

    devices.push({
      id,
      model,
      manufacturer,
    });
  }

  return devices;
};
