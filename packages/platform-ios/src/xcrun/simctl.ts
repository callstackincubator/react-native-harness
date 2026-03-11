import {
  type AppleAppLaunchOptions,
  type CrashArtifactWriter,
} from '@react-native-harness/platforms';
import { escapeRegExp, spawn, spawnAndForget } from '@react-native-harness/tools';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { iosCrashParser } from '../crash-parser.js';

const plistToJson = async (
  plistOutput: string
): Promise<Record<string, unknown>> => {
  const { stdout: jsonOutput } = await spawn(
    'plutil',
    ['-convert', 'json', '-o', '-', '-'],
    { stdin: { string: plistOutput } }
  );
  return JSON.parse(jsonOutput) as Record<string, unknown>;
};

export type AppleAppInfo = {
  Bundle: string;
  CFBundleIdentifier: string;
  CFBundleExecutable: string;
  CFBundleName: string;
  CFBundleDisplayName: string;
  Path: string;
};

export type AppleSimulatorCrashReport = {
  artifactType: 'ios-simulator-crash-report';
  artifactPath: string;
  occurredAt: number;
  summary?: string;
  rawLines: string[];
  processName?: string;
  pid?: number;
  signal?: string;
  exceptionType?: string;
  stackTrace?: string[];
};

const getDiagnosticReportsDir = () =>
  join(homedir(), 'Library', 'Logs', 'DiagnosticReports');

export const collectCrashReports = async ({
  udid,
  bundleId,
  processNames,
  crashArtifactWriter,
  minOccurredAt,
}: {
  udid: string;
  bundleId: string;
  processNames: string[];
  crashArtifactWriter?: CrashArtifactWriter;
  minOccurredAt?: number;
}): Promise<AppleSimulatorCrashReport[]> => {
  const diagnosticReportsDir = getDiagnosticReportsDir();

  if (!fs.existsSync(diagnosticReportsDir)) {
    return [];
  }

  return fs
    .readdirSync(diagnosticReportsDir)
    .filter((entry) => entry.endsWith('.ips'))
    .map((entry) => join(diagnosticReportsDir, entry))
    .map((path) => ({
      path,
      contents: fs.readFileSync(path, 'utf8'),
    }))
    .filter(({ path, contents }) => {
      if (!contents.includes(bundleId) && !path.includes(bundleId)) {
        const matchesProcessName = processNames.some((processName) =>
          new RegExp(`\\b${escapeRegExp(processName)}\\b`).test(contents)
        );

        if (!matchesProcessName) {
          return false;
        }
      }

      return contents.includes(udid);
    })
    .map(({ path, contents }) => ({
      path,
      report: iosCrashParser.parse({
        path,
        contents,
      }),
    }))
    .filter(
      (
        entry
      ): entry is { path: string; report: Omit<AppleSimulatorCrashReport, 'artifactPath' | 'artifactType'> } =>
        entry.report !== null
    )
    .filter(
      ({ report }) => minOccurredAt === undefined || report.occurredAt >= minOccurredAt
    )
    .map(({ path, report }) => {
      if (!crashArtifactWriter) {
        return {
          artifactType: 'ios-simulator-crash-report',
          artifactPath: path,
          ...report,
        };
      }

      return {
        artifactType: 'ios-simulator-crash-report',
        ...report,
        artifactPath: crashArtifactWriter.persistArtifact({
          artifactKind: 'ios-simulator-crash-report',
          source: {
            kind: 'file',
            path,
          },
        }),
      };
    });
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

  return json as AppleAppInfo;
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

export const getSimctlChildEnvironment = (
  options?: AppleAppLaunchOptions
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(options?.environment ?? {}).map(([key, value]) => [
      `SIMCTL_CHILD_${key}`,
      value,
    ])
  );

export const startApp = async (
  udid: string,
  bundleId: string,
  options?: AppleAppLaunchOptions
): Promise<void> => {
  const environment = getSimctlChildEnvironment(options);
  const argumentsList = options?.arguments ?? [];

  await spawn('xcrun', ['simctl', 'launch', udid, bundleId, ...argumentsList], {
    env: environment,
  });
};

export const stopApp = async (
  udid: string,
  bundleId: string
): Promise<void> => {
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

export const isAppRunning = async (
  udid: string,
  bundleId: string
): Promise<boolean> => {
  try {
    const { stdout } = await spawn('xcrun', [
      'simctl',
      'spawn',
      udid,
      'launchctl',
      'list',
    ]);
    return stdout.includes(bundleId);
  } catch {
    return false;
  }
};

export const screenshot = async (
  udid: string,
  destination: string
): Promise<string> => {
  await spawn('xcrun', ['simctl', 'io', udid, 'screenshot', destination]);
  return destination;
};
