import { type AppleAppLaunchOptions } from '@react-native-harness/platforms';
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
  const separatorIndex = args.indexOf('--');
  const argsWithJsonOutput =
    separatorIndex === -1
      ? [...args, '--json-output', tempFile]
      : [
          ...args.slice(0, separatorIndex),
          '--json-output',
          tempFile,
          ...args.slice(separatorIndex),
        ];

  await spawn('xcrun', ['devicectl', command, ...argsWithJsonOutput]);

  if (!fs.existsSync(tempFile)) {
    throw new Error(`devicectl did not produce JSON output at ${tempFile}`);
  }

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

type DevicectlFileInfo = {
  path?: string;
  filePath?: string;
  relativePath?: string;
  name?: string;
};

const getDevicectlPath = (file: DevicectlFileInfo): string | null => {
  return file.path ?? file.filePath ?? file.relativePath ?? file.name ?? null;
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
  bundleId: string,
  options?: AppleAppLaunchOptions
): Promise<void> => {
  await devicectl(
    'device',
    getDeviceCtlLaunchArgs(identifier, bundleId, options)
  );
};

export const getDeviceCtlLaunchArgs = (
  identifier: string,
  bundleId: string,
  options?: AppleAppLaunchOptions
): string[] => {
  const args = ['process', 'launch', '--device', identifier];
  const environment = options?.environment;

  if (environment && Object.keys(environment).length > 0) {
    args.push('--environment-variables', JSON.stringify(environment));
  }

  args.push(bundleId);

  if (options?.arguments?.length) {
    args.push('--', ...options.arguments);
  }

  return args;
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

export const listFiles = async (
  identifier: string,
  options: {
    domainType: 'systemCrashLogs';
    recursive?: boolean;
    subdirectory?: string;
  }
): Promise<string[]> => {
  const args = [
    'info',
    'files',
    '--device',
    identifier,
    '--domain-type',
    options.domainType,
  ];

  if (options.subdirectory) {
    args.push('--subdirectory', options.subdirectory);
  }

  args.push(options.recursive === false ? '--no-recurse' : '--recurse');

  const result = await devicectl<{
    items?: DevicectlFileInfo[];
    files?: DevicectlFileInfo[];
  }>('device', args);
  const items = result.items ?? result.files ?? [];

  return items
    .map(getDevicectlPath)
    .filter((path): path is string => Boolean(path));
};

export const copyFileFrom = async (
  identifier: string,
  options: {
    source: string;
    destination: string;
    domainType: 'systemCrashLogs';
  }
): Promise<void> => {
  await devicectl('device', [
    'copy',
    'from',
    '--device',
    identifier,
    '--source',
    options.source,
    '--destination',
    options.destination,
    '--domain-type',
    options.domainType,
  ]);
};

export const diagnose = async (
  identifier: string,
  outputDir: string
): Promise<void> => {
  await devicectl('diagnose', [
    '--devices',
    identifier,
    '--no-archive',
    '--archive-destination',
    outputDir,
    '--keep-temp-dir',
  ]);
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

export const getDevice = async (
  name: string
): Promise<AppleDeviceInfo | null> => {
  const devices = await listDevices();
  return (
    devices.find((device) => device.deviceProperties.name === name) ?? null
  );
};

export const getDeviceId = async (name: string): Promise<string | null> => {
  const device = await getDevice(name);
  return device?.identifier ?? null;
};

export const isAppRunning = async (
  identifier: string,
  bundleId: string
): Promise<boolean> => {
  const appInfo = await getAppInfo(identifier, bundleId);

  if (!appInfo) {
    return false;
  }

  const processes = await getProcesses(identifier);
  return processes.some((process) =>
    process.executable.startsWith(appInfo.url)
  );
};
