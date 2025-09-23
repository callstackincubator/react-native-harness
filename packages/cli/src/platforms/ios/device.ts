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
  simulatorName: string
): Promise<any | null> => {
  const devices = await listDevices();

  for (const runtime in devices.devices) {
    const runtimeDevices = devices.devices[runtime];
    for (const device of runtimeDevices) {
      if (device.name === simulatorName && device.isAvailable) {
        return device;
      }
    }
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
  simulatorName: string,
  bundleId: string
): Promise<boolean> => {
  const device = await getDeviceByName(simulatorName);

  if (!device) {
    throw new Error(`Simulator ${simulatorName} not found`);
  }

  const appList = await listApps(device.udid);
  return appList.includes(bundleId);
};

export const runApp = async (
  simulatorName: string,
  appName: string
): Promise<void> => {
  await killApp(simulatorName, appName);
  await spawn('xcrun', ['simctl', 'launch', simulatorName, appName]);
};

export const killApp = async (
  simulatorName: string,
  appName: string
): Promise<void> => {
  await spawnAndForget('xcrun', [
    'simctl',
    'terminate',
    simulatorName,
    appName,
  ]);
};
