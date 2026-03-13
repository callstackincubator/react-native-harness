import {
  DependencyNotFoundError,
  type CrashArtifactWriter,
} from '@react-native-harness/platforms';
import { escapeRegExp, spawn, type Subprocess } from '@react-native-harness/tools';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iosCrashParser } from './crash-parser.js';

const REQUIRED_BINARIES = [
  'idevicesyslog',
  'idevicecrashreport',
  'idevice_id',
] as const;

const INSTALL_INSTRUCTIONS =
  'Install libimobiledevice and ensure idevicesyslog, idevicecrashreport, and idevice_id are available in PATH.';

export type IosCrashArtifact = {
  artifactType: 'ios-crash-report';
  artifactPath: string;
  summary?: string;
  rawLines: string[];
  processName?: string;
  pid?: number;
  signal?: string;
  exceptionType?: string;
  stackTrace?: string[];
  occurredAt: number;
};

const shouldIncludeCrashReport = ({
  path,
  contents,
  bundleId,
  processNames,
}: {
  path: string;
  contents: string;
  bundleId: string;
  processNames: string[];
}) => {
  if (contents.includes(bundleId) || path.includes(bundleId)) {
    return true;
  }

  return processNames.some((processName) => {
    const processPattern = new RegExp(`\\b${escapeRegExp(processName)}\\b`);

    return processPattern.test(contents) || processPattern.test(path);
  });
};

export const assertLibimobiledeviceInstalled = async (): Promise<void> => {
  for (const binary of REQUIRED_BINARIES) {
    try {
      await spawn('which', [binary]);
    } catch {
      throw new DependencyNotFoundError('libimobiledevice', INSTALL_INSTRUCTIONS);
    }
  }
};

export const assertLibimobiledeviceTargetAvailable = async (
  targetId: string
): Promise<void> => {
  try {
    await spawn('idevicesyslog', ['-u', targetId, 'pidlist']);
  } catch (error) {
    throw new Error(
      `libimobiledevice could not attach to iOS target "${targetId}". ${error instanceof Error ? error.message : ''}`.trim()
    );
  }
};

export const createSyslogProcess = ({
  targetId,
  processNames,
}: {
  targetId: string;
  processNames: string[];
}): Subprocess =>
  spawn(
    'idevicesyslog',
    ['-u', targetId, '--exit', '--process', processNames.join('|')],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

const getCrashReportFilterName = (
  processNames: string[],
  bundleId: string
) => processNames.find((name) => name !== bundleId) ?? processNames[0];

const isCrashReportFile = (entry: string) =>
  entry.endsWith('.crash') || entry.endsWith('.ips');

export const collectCrashReports = async ({
  targetId,
  bundleId,
  processNames,
  crashArtifactWriter,
  minOccurredAt,
}: {
  targetId: string;
  bundleId: string;
  processNames: string[];
  crashArtifactWriter?: CrashArtifactWriter;
  minOccurredAt?: number;
}): Promise<IosCrashArtifact[]> => {
  const crashDir = fs.mkdtempSync(join(tmpdir(), 'rn-harness-ios-crashes-'));

  try {
    const filterName = getCrashReportFilterName(processNames, bundleId);

    await spawn('idevicecrashreport', [
      '-u',
      targetId,
      '--keep',
      '--extract',
      ...(filterName ? ['--filter', filterName] : []),
      crashDir,
    ]);

    const reportPaths = fs
      .readdirSync(crashDir)
      .filter(isCrashReportFile)
      .map((entry) => join(crashDir, entry));

    return reportPaths
      .map((path) => ({
        path,
        contents: fs.readFileSync(path, 'utf8'),
      }))
      .filter(({ path, contents }) =>
        shouldIncludeCrashReport({
          path,
          contents,
          bundleId,
          processNames,
        })
      )
      .map(({ path, contents }) => {
        const report = iosCrashParser.parse({
          path,
          contents,
        });

        if (!report) {
          return null;
        }

        if (minOccurredAt !== undefined && report.occurredAt < minOccurredAt) {
          return null;
        }

        if (!crashArtifactWriter) {
          return {
            artifactType: 'ios-crash-report',
            artifactPath: path,
            ...report,
          };
        }

        return {
          artifactType: 'ios-crash-report',
          ...report,
          artifactPath: crashArtifactWriter.persistArtifact({
            artifactKind: 'ios-crash-report',
            source: {
              kind: 'file',
              path,
            },
          }),
        };
      })
      .filter((report): report is IosCrashArtifact => report !== null);
  } finally {
    fs.rmSync(crashDir, { recursive: true, force: true });
  }
};
