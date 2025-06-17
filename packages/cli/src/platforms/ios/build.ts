import { spawn } from '@react-native-harness/tools';
import { reloadApp } from '../../bundlers/metro.js';

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

export const installPods = async (): Promise<void> => {
  await spawn('bundle', ['exec', 'pod', 'install'], { cwd: 'ios' });
};

export const listApps = async (udid: string): Promise<string[]> => {
  const { stdout } = await spawn('xcrun', ['simctl', 'listapps', udid]);
  return stdout.split('\n').map((line) => line.trim());
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

export const buildIOSApp = async (simulatorName: string): Promise<void> => {
  await installPods();
  await spawn('npx', [
    'react-native',
    'run-ios',
    `--simulator=${simulatorName}`,
    '--no-packager',
  ]);
  await reloadApp(8081);
};

export const runApp = async (
  simulatorName: string,
  appName: string
): Promise<void> => {
  await spawn('xcrun', ['simctl', 'terminate', simulatorName, appName]);
  await spawn('xcrun', ['simctl', 'launch', simulatorName, appName]);
};

export const killApp = async (
  simulatorName: string,
  appName: string
): Promise<void> => {
  await spawn('xcrun', ['simctl', 'terminate', simulatorName, appName]);
};
