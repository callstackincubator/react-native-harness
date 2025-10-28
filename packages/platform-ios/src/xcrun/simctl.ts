import { spawn, spawnAndForget } from '@react-native-harness/tools';

const plistToJson = async (plistOutput: string): Promise<any> => {
  const { stdout: jsonOutput } = await spawn(
    'plutil',
    ['-convert', 'json', '-o', '-', '-'],
    { stdin: { string: plistOutput } }
  );
  return JSON.parse(jsonOutput);
};

export type AppleAppInfo = {
  Bundle: string;
  CFBundleIdentifier: string;
  CFBundleName: string;
  CFBundleDisplayName: string;
  Path: string;
};

export const getAppInfo = async (
  udid: string,
  bundleId: string
): Promise<AppleAppInfo | null> => {
  const { stdout: plistOutput } = await spawn('xcrun', [
    'simctl',
    'appinfo',
    udid,
    bundleId,
  ]);

  const json = await plistToJson(plistOutput);

  // If there is only one entry, it means the app is not installed
  const hasMoreThanOneEntry = Object.keys(json).length > 1;

  if (!hasMoreThanOneEntry) {
    return null;
  }

  return json;
};

export const isAppInstalled = async (
  udid: string,
  bundleId: string
): Promise<boolean> => {
  const appInfo = await getAppInfo(udid, bundleId);
  return appInfo !== null;
};

export type AppleSimulatorState = 'Booted' | 'Booting' | 'Shutdown';

export type AppleSimulatorInfo = {
  name: string;
  udid: string;
  state: AppleSimulatorState;
  isAvailable: boolean;
  runtime: string;
};

export const getSimulators = async (): Promise<AppleSimulatorInfo[]> => {
  const { stdout } = await spawn('xcrun', [
    'simctl',
    'list',
    'devices',
    '--json',
  ]);
  const runtimeDevices: Record<string, AppleSimulatorInfo[]> =
    JSON.parse(stdout).devices;
  const simulators: AppleSimulatorInfo[] = [];

  Object.entries(runtimeDevices).forEach(([runtime, devices]) => {
    devices.forEach((device) => {
      simulators.push({
        ...device,
        runtime,
      });
    });
  });

  return simulators;
};

export const getSimulatorStatus = async (
  udid: string
): Promise<AppleSimulatorState> => {
  const simulators = await getSimulators();
  const simulator = simulators.find((s) => s.udid === udid);

  if (!simulator) {
    throw new Error(`Simulator with UDID ${udid} not found`);
  }

  return simulator.state;
};

export const startApp = async (
  udid: string,
  bundleId: string
): Promise<void> => {
  await spawn('xcrun', ['simctl', 'launch', udid, bundleId]);
};

export const stopApp = async (
  udid: string,
  bundleId: string
): Promise<void> => {
  //
  await spawnAndForget('xcrun', ['simctl', 'terminate', udid, bundleId]);
};

export const getSimulatorId = async (
  name: string,
  systemVersion: string
): Promise<string | null> => {
  const simulators = await getSimulators();
  const simulator = simulators.find(
    (s) =>
      s.name === name && s.runtime.endsWith(systemVersion.replaceAll('.', '-'))
  );

  return simulator?.udid ?? null;
};
