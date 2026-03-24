import {
  type AppleAppLaunchOptions,
  type CrashArtifactWriter,
} from '@react-native-harness/platforms';
import {
  logger,
  spawn,
  spawnAndForget,
  SubprocessError,
} from '@react-native-harness/tools';
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
  artifactType: 'ios-crash-report';
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
  processNames,
  crashArtifactWriter,
  minOccurredAt,
}: {
  udid: string;
  /** Kept for API compatibility; no longer used for content-based filtering. */
  bundleId: string;
  processNames: string[];
  crashArtifactWriter?: CrashArtifactWriter;
  minOccurredAt?: number;
}): Promise<AppleSimulatorCrashReport[]> => {
  const diagnosticReportsDir = getDiagnosticReportsDir();

  logger.debug('[simctl] collectCrashReports', { udid, processNames, minOccurredAt, diagnosticReportsDir });

  if (!fs.existsSync(diagnosticReportsDir)) {
    logger.debug('[simctl] DiagnosticReports directory does not exist, skipping');
    return [];
  }

  const allEntries = fs.readdirSync(diagnosticReportsDir);
  const ipsEntries = allEntries.filter((entry) => entry.endsWith('.ips'));
  logger.debug(`[simctl] Found ${allEntries.length} total entries, ${ipsEntries.length} .ips files in DiagnosticReports`);

  // Crash files are named {ProcessName}-YYYY-MM-DD-HHMMSS.ips, so filter by filename prefix.
  const matchingEntries = ipsEntries.filter((entry) =>
    processNames.some((name) => entry.startsWith(`${name}-`))
  );
  logger.debug(`[simctl] ${matchingEntries.length} file(s) match process names by filename prefix`);

  type CrashCandidate = AppleSimulatorCrashReport & { contents: string };
  const candidates: CrashCandidate[] = [];

  for (const entry of matchingEntries) {
    const path = join(diagnosticReportsDir, entry);
    const contents = fs.readFileSync(path, 'utf8');
    const report = iosCrashParser.parse({ path, contents });

    if (!report) {
      logger.debug(`[simctl] Skipping ${entry}: failed to parse crash report`);
      continue;
    }

    if (minOccurredAt !== undefined && report.occurredAt < minOccurredAt) {
      logger.debug(`[simctl] Skipping ${entry}: occurredAt ${report.occurredAt} is older than minOccurredAt ${minOccurredAt}`);
      continue;
    }

    logger.debug(`[simctl] Candidate crash report: ${entry}`, { occurredAt: report.occurredAt, processName: report.processName, pid: report.pid });
    candidates.push({
      ...report,
      rawLines: report.rawLines ?? [],
      artifactPath: path,
      artifactType: 'ios-crash-report',
      contents,
    });
  }

  if (candidates.length === 0) {
    logger.debug('[simctl] No candidates after filtering');
    return [];
  }

  // Walk from latest to oldest and return the first report that belongs to this simulator.
  const sorted = candidates.sort((a, b) => b.occurredAt - a.occurredAt);

  for (const candidate of sorted) {
    if (!candidate.contents.includes(udid)) {
      logger.debug(`[simctl] Skipping candidate (occurredAt=${candidate.occurredAt}): does not contain udid ${udid}`);
      continue;
    }

    logger.debug(`[simctl] Matched crash report for simulator`, { occurredAt: candidate.occurredAt, processName: candidate.processName, pid: candidate.pid });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contents: _contents, ...report } = candidate;

    if (!crashArtifactWriter) {
      return [report];
    }

    const artifactPath = crashArtifactWriter.persistArtifact({
      artifactKind: 'ios-crash-report',
      source: {
        kind: 'file',
        path: report.artifactPath,
      },
    });
    logger.debug(`[simctl] Persisted crash artifact to: ${artifactPath}`);
    return [{ ...report, artifactPath }];
  }

  logger.debug('[simctl] No candidates matched the simulator udid');
  return [];
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

const HARNESS_JS_LOCATION_BACKUP_KEY =
  'react_native_harness_RCT_jsLocation_backup';
const HARNESS_MISSING_VALUE = '__RN_HARNESS_MISSING__';

const getDefaultsValue = async (
  udid: string,
  bundleId: string,
  key: string
): Promise<string | null> => {
  try {
    const { stdout } = await spawn('xcrun', [
      'simctl',
      'spawn',
      udid,
      'defaults',
      'read',
      bundleId,
      key,
    ]);
    return stdout.trim() || null;
  } catch (error) {
    if (error instanceof SubprocessError && error.exitCode === 1) {
      return null;
    }

    throw error;
  }
};

const writeDefaultsValue = async (
  udid: string,
  bundleId: string,
  key: string,
  value: string
): Promise<void> => {
  await spawn('xcrun', [
    'simctl',
    'spawn',
    udid,
    'defaults',
    'write',
    bundleId,
    key,
    value,
  ]);
};

const deleteDefaultsValue = async (
  udid: string,
  bundleId: string,
  key: string
): Promise<void> => {
  try {
    await spawn('xcrun', [
      'simctl',
      'spawn',
      udid,
      'defaults',
      'delete',
      bundleId,
      key,
    ]);
  } catch (error) {
    if (error instanceof SubprocessError && error.exitCode === 1) {
      return;
    }

    throw error;
  }
};

export const applyHarnessJsLocationOverride = async (
  udid: string,
  bundleId: string,
  host: string
): Promise<void> => {
  const backupValue = await getDefaultsValue(
    udid,
    bundleId,
    HARNESS_JS_LOCATION_BACKUP_KEY
  );

  if (backupValue === null) {
    const existingValue = await getDefaultsValue(udid, bundleId, 'RCT_jsLocation');
    await writeDefaultsValue(
      udid,
      bundleId,
      HARNESS_JS_LOCATION_BACKUP_KEY,
      existingValue ?? HARNESS_MISSING_VALUE
    );
  }

  await writeDefaultsValue(udid, bundleId, 'RCT_jsLocation', host);
};

export const clearHarnessJsLocationOverride = async (
  udid: string,
  bundleId: string
): Promise<void> => {
  const backupValue = await getDefaultsValue(
    udid,
    bundleId,
    HARNESS_JS_LOCATION_BACKUP_KEY
  );

  if (backupValue === null) {
    return;
  }

  if (backupValue === HARNESS_MISSING_VALUE) {
    await deleteDefaultsValue(udid, bundleId, 'RCT_jsLocation');
  } else {
    await writeDefaultsValue(udid, bundleId, 'RCT_jsLocation', backupValue);
  }

  await deleteDefaultsValue(udid, bundleId, HARNESS_JS_LOCATION_BACKUP_KEY);
};

export const screenshot = async (
  udid: string,
  destination: string
): Promise<string> => {
  await spawn('xcrun', ['simctl', 'io', udid, 'screenshot', destination]);
  return destination;
};
