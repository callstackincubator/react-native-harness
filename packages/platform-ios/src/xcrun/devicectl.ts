import { spawn } from '@react-native-harness/tools';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const devicectl = async <TOutput>(
  command: string,
  args: string[]
): Promise<TOutput> => {
  const tempFile = join(tmpdir(), `devicectl-${randomUUID()}.json`);

  await spawn('xcrun', [
    'devicectl',
    command,
    ...args,
    '--json-output',
    tempFile,
  ]);

  const output = fs.readFileSync(tempFile, 'utf8');
  fs.unlinkSync(tempFile);

  return JSON.parse(output).result;
};

export type AppleDeviceInfo = {
  identifier: string;
  deviceProperties: {
    name: string;
    osVersionNumber: string;
  };
  hardwareProperties: {
    marketingName: string;
    productType: string;
    udid: string;
  };
};

export const listDevices = async (): Promise<AppleDeviceInfo[]> => {
  const result = await devicectl<{ devices: AppleDeviceInfo[] }>('list', [
    'devices',
  ]);
  return result.devices;
};

export type AppleAppInfo = {
  bundleIdentifier: string;
  name: string;
  version: string;
  url: string;
};

export const listApps = async (identifier: string): Promise<AppleAppInfo[]> => {
  const result = await devicectl<{ apps: AppleAppInfo[] }>('device', [
    'info',
    'apps',
    '--device',
    identifier,
  ]);
  return result.apps;
};

export const getAppInfo = async (
  identifier: string,
  bundleId: string
): Promise<AppleAppInfo | null> => {
  const result = await devicectl<{ apps: AppleAppInfo[] }>('device', [
    'info',
    'apps',
    '--device',
    identifier,
    '--bundle-id',
    bundleId,
  ]);

  return result.apps[0] ?? null;
};

export const isAppInstalled = async (
  identifier: string,
  bundleId: string
): Promise<boolean> => {
  const apps = await listApps(identifier);
  return apps.some((app) => app.bundleIdentifier === bundleId);
};

export const startApp = async (
  identifier: string,
  bundleId: string
): Promise<void> => {
  await devicectl('device', [
    'process',
    'launch',
    '--device',
    identifier,
    bundleId,
  ]);
};

export type AppleProcessInfo = {
  executable: string;
  processIdentifier: number;
};

export const getProcesses = async (
  identifier: string
): Promise<AppleProcessInfo[]> => {
  const result = await devicectl<{ runningProcesses: AppleProcessInfo[] }>(
    'device',
    ['info', 'processes', '--device', identifier]
  );

  return result.runningProcesses;
};

export const stopApp = async (
  identifier: string,
  bundleId: string
): Promise<void> => {
  const appInfo = await getAppInfo(identifier, bundleId);

  if (!appInfo) {
    return;
  }

  const processes = await getProcesses(identifier);
  const process = processes.find((process) =>
    process.executable.startsWith(appInfo.url)
  );

  if (!process) {
    return;
  }

  await devicectl('device', [
    'process',
    'terminate',
    '--device',
    identifier,
    '--pid',
    process.processIdentifier.toString(),
  ]);
};

export const getDeviceId = async (name: string): Promise<string | null> => {
  const devices = await listDevices();
  const device = devices.find(
    (device) => device.deviceProperties.name === name
  );

  return device?.identifier ?? null;
};
