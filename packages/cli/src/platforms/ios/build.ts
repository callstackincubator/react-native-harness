import { spawn, spawnAndForget } from '@react-native-harness/tools';

export const listDevices = async (): Promise<any> => {
  const { stdout } = await spawn('xcrun', [
    'simctl',
    'list',
    'devices',
    '--json',
  ]);
  return JSON.parse(stdout);
};

export const getDeviceByName = async (
  simulatorName: string,
  systemVersion: string
): Promise<any | null> => {
  const devices = await listDevices();
  const expectedRuntimeId = `com.apple.CoreSimulator.SimRuntime.iOS-${systemVersion.replace(
    /\./,
    '-'
  )}`;

  const runtime = devices.devices[expectedRuntimeId];

  if (!runtime) {
    return null;
  }

  const runtimeDevices = devices.devices[runtime];
  const device = runtimeDevices.find((d: any) => d.name === simulatorName);

  if (device) {
    return device;
  }

  return null;
};

export const listApps = async (udid: string): Promise<string[]> => {
  const { stdout: plistOutput } = await spawn('xcrun', [
    'simctl',
    'listapps',
    udid,
  ]);
  const { stdout: jsonOutput } = await spawn(
    'plutil',
    ['-convert', 'json', '-o', '-', '-'],
    { stdin: { string: plistOutput } }
  );
  return Object.keys(JSON.parse(jsonOutput));
};

export const isAppInstalled = async (
  udid: string,
  bundleId: string
): Promise<boolean> => {
  const appList = await listApps(udid);
  return appList.includes(bundleId);
};

export const runApp = async (udid: string, appName: string): Promise<void> => {
  await killApp(udid, appName);
  await spawn('xcrun', ['simctl', 'launch', udid, appName]);
};

export const killApp = async (udid: string, appName: string): Promise<void> => {
  await spawnAndForget('xcrun', ['simctl', 'terminate', udid, appName]);
};
