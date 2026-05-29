import type {
  AppCrashDetails,
  CrashArtifactWriter,
  CrashDetailsLookupOptions,
} from '@react-native-harness/platforms';
import { logger } from '@react-native-harness/tools';
import fs from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { iosCrashParser } from './crash-parser.js';
import * as devicectl from './xcrun/devicectl.js';
import * as simctl from './xcrun/simctl.js';

const crashDiagnosticsLogger = logger.child('ios-crash-diagnostics');

const CRASH_ARTIFACT_WAIT_TIMEOUT_MS = 30000;
const CRASH_ARTIFACT_POLL_INTERVAL_MS = 1500;

type CollectIosCrashArtifactsOptions = {
  processNames: string[];
  bundleId: string;
  crashArtifactWriter?: CrashArtifactWriter;
  minOccurredAt?: number;
};

type CollectSimulatorCrashArtifactsOptions = CollectIosCrashArtifactsOptions & {
  targetType: 'simulator';
  targetId: string;
};

type CollectPhysicalCrashArtifactsOptions = CollectIosCrashArtifactsOptions & {
  targetType: 'device';
  targetId: string;
};

type CollectCrashArtifactsOptions =
  | CollectSimulatorCrashArtifactsOptions
  | CollectPhysicalCrashArtifactsOptions;

type DiagnosedCrashArtifact = AppCrashDetails & {
  artifactType: 'ios-crash-report';
  artifactPath: string;
  occurredAt: number;
  bundleId?: string;
  targetId?: string;
  score?: number;
};

type WaitForCrashArtifactOptions = {
  lookup: CrashDetailsLookupOptions;
  options: CollectCrashArtifactsOptions;
  getFallbackArtifact: () => AppCrashDetails | null;
  recordArtifact: (artifact: AppCrashDetails) => void;
};

const isCrashReportFile = (path: string) =>
  path.endsWith('.ips') || path.endsWith('.crash');

const collectFilesRecursively = (rootDir: string): string[] => {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
};

const createTempDirectory = (prefix: string) => {
  const path = join(tmpdir(), `${prefix}-${randomUUID()}`);
  fs.mkdirSync(path, { recursive: true });
  return path;
};

const scoreCrashArtifact = ({
  artifact,
  options,
  lookup,
}: {
  artifact: DiagnosedCrashArtifact;
  options: CollectCrashArtifactsOptions;
  lookup?: CrashDetailsLookupOptions;
}) => {
  let score = 0;

  if (options.processNames.includes(artifact.processName ?? '')) {
    score += 40;
  }

  if (artifact.bundleId === options.bundleId) {
    score += 30;
  }

  if (lookup?.pid !== undefined && artifact.pid === lookup.pid) {
    score += 100;
  }

  if (lookup?.processName && artifact.processName === lookup.processName) {
    score += 80;
  }

  if (artifact.targetId === options.targetId) {
    score += 50;
  }

  const referenceTime = lookup?.occurredAt ?? options.minOccurredAt;

  if (referenceTime !== undefined) {
    const distance = Math.abs(artifact.occurredAt - referenceTime);

    if (distance <= 5_000) {
      score += 40;
    } else if (distance <= 30_000) {
      score += 20;
    } else if (distance <= 120_000) {
      score += 5;
    }
  }

  return score;
};

const getBestMatchingArtifact = ({
  artifacts,
  options,
  lookup,
}: {
  artifacts: DiagnosedCrashArtifact[];
  options: CollectCrashArtifactsOptions;
  lookup: CrashDetailsLookupOptions;
}) => {
  const scoredArtifacts = artifacts
    .map((artifact) => ({
      artifact,
      score: scoreCrashArtifact({ artifact, options, lookup }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.artifact.occurredAt - left.artifact.occurredAt;
    });

  return scoredArtifacts[0]?.artifact ?? null;
};

const parseCrashArtifacts = ({
  rootDir,
  options,
  lookup,
}: {
  rootDir: string;
  options: CollectCrashArtifactsOptions;
  lookup?: CrashDetailsLookupOptions;
}): DiagnosedCrashArtifact[] => {
  const candidates = collectFilesRecursively(rootDir)
    .filter(isCrashReportFile)
    .map((path) => {
      const contents = fs.readFileSync(path, 'utf8');
      const parsed = iosCrashParser.parse({ path, contents });

      if (!parsed) {
        return null;
      }

      if (
        options.minOccurredAt !== undefined &&
        parsed.occurredAt < options.minOccurredAt
      ) {
        return null;
      }

      const artifactPath = options.crashArtifactWriter
        ? options.crashArtifactWriter.persistArtifact({
            artifactKind: 'ios-crash-report',
            source: {
              kind: 'file',
              path,
            },
            testFilePath: lookup?.testFilePath,
          })
        : path;

      const artifact: DiagnosedCrashArtifact = {
        ...parsed,
        artifactType: 'ios-crash-report',
        artifactPath,
        occurredAt: parsed.occurredAt,
      };

      artifact.score = scoreCrashArtifact({ artifact, options, lookup });
      return artifact;
    })
    .filter((artifact): artifact is DiagnosedCrashArtifact =>
      Boolean(artifact)
    );

  return candidates.sort((left, right) => {
    if ((right.score ?? 0) !== (left.score ?? 0)) {
      return (right.score ?? 0) - (left.score ?? 0);
    }

    return right.occurredAt - left.occurredAt;
  });
};

const collectSimulatorCrashArtifacts = async (
  { targetId, ...options }: CollectSimulatorCrashArtifactsOptions,
  lookup?: CrashDetailsLookupOptions
) => {
  const diagnosticReportArtifacts = collectCrashArtifactsFromDiagnosticReports(
    {
      ...options,
      targetId,
      targetType: 'simulator',
    },
    lookup
  );

  if (diagnosticReportArtifacts.length > 0) {
    return diagnosticReportArtifacts;
  }

  const outputDir = createTempDirectory('rn-harness-simctl-diagnose');

  try {
    await simctl.diagnose(targetId, outputDir);
    return parseCrashArtifacts({
      rootDir: outputDir,
      options: { ...options, targetId, targetType: 'simulator' },
      lookup,
    });
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
};

const collectCrashArtifactsFromDiagnosticReports = (
  options: CollectCrashArtifactsOptions,
  lookup?: CrashDetailsLookupOptions
): DiagnosedCrashArtifact[] => {
  const diagnosticReportsDir = join(
    homedir(),
    'Library',
    'Logs',
    'DiagnosticReports'
  );

  if (!fs.existsSync(diagnosticReportsDir)) {
    return [];
  }

  const matchingEntries = fs
    .readdirSync(diagnosticReportsDir)
    .filter((entry) => entry.endsWith('.ips'))
    .filter((entry) =>
      options.processNames.some((name) => entry.startsWith(`${name}-`))
    );

  const artifacts: DiagnosedCrashArtifact[] = [];

  for (const entry of matchingEntries) {
    const path = join(diagnosticReportsDir, entry);
    const contents = fs.readFileSync(path, 'utf8');
    const parsed = iosCrashParser.parse({ path, contents });

    if (!parsed) {
      continue;
    }

    if (
      options.targetType === 'simulator' &&
      (parsed.targetId !== options.targetId ||
        !contents.includes(options.targetId))
    ) {
      continue;
    }

    if (
      options.minOccurredAt !== undefined &&
      parsed.occurredAt < options.minOccurredAt
    ) {
      continue;
    }

    const artifactPath = options.crashArtifactWriter
      ? options.crashArtifactWriter.persistArtifact({
          artifactKind: 'ios-crash-report',
          source: { kind: 'file', path },
          testFilePath: lookup?.testFilePath,
        })
      : path;

    const artifact: DiagnosedCrashArtifact = {
      ...parsed,
      artifactType: 'ios-crash-report',
      artifactPath,
      occurredAt: parsed.occurredAt,
    };

    artifact.score = scoreCrashArtifact({ artifact, options, lookup });
    artifacts.push(artifact);
  }

  return artifacts.sort((left, right) => {
    if ((right.score ?? 0) !== (left.score ?? 0)) {
      return (right.score ?? 0) - (left.score ?? 0);
    }

    return right.occurredAt - left.occurredAt;
  });
};

const collectPhysicalCrashArtifacts = async (
  {
    targetId,
    processNames,
    bundleId,
    crashArtifactWriter,
    minOccurredAt,
  }: CollectPhysicalCrashArtifactsOptions,
  lookup?: CrashDetailsLookupOptions
) => {
  const crashLogsDir = createTempDirectory('rn-harness-devicectl-crash-logs');

  try {
    const remoteCrashLogPaths = await devicectl.listFiles(targetId, {
      domainType: 'systemCrashLogs',
      recursive: true,
    });
    const filteredCrashLogPaths = remoteCrashLogPaths.filter((remotePath) =>
      processNames.some((processName) => remotePath.includes(processName))
    );

    if (filteredCrashLogPaths.length > 0) {
      for (const remotePath of filteredCrashLogPaths) {
        const fileName = remotePath.split('/').pop();

        if (!fileName) {
          continue;
        }

        await devicectl.copyFileFrom(targetId, {
          source: remotePath,
          destination: join(crashLogsDir, fileName),
          domainType: 'systemCrashLogs',
        });
      }

      const copiedArtifacts = parseCrashArtifacts({
        rootDir: crashLogsDir,
        lookup,
        options: {
          targetId,
          targetType: 'device',
          processNames,
          bundleId,
          crashArtifactWriter,
          minOccurredAt,
        },
      });

      if (copiedArtifacts.length > 0) {
        return copiedArtifacts;
      }
    }
  } finally {
    fs.rmSync(crashLogsDir, { recursive: true, force: true });
  }

  return collectCrashArtifactsFromDiagnosticReports(
    {
      targetId,
      targetType: 'device',
      processNames,
      bundleId,
      crashArtifactWriter,
      minOccurredAt,
    },
    lookup
  );
};

export const collectCrashArtifacts = async (
  options: CollectCrashArtifactsOptions,
  lookup?: CrashDetailsLookupOptions
): Promise<DiagnosedCrashArtifact[]> => {
  crashDiagnosticsLogger.debug('collecting crash artifacts: %o', {
    targetId: options.targetId,
    targetType: options.targetType,
    processNames: options.processNames,
    minOccurredAt: options.minOccurredAt,
  });

  if (options.targetType === 'simulator') {
    return collectSimulatorCrashArtifacts(options, lookup);
  }

  return collectPhysicalCrashArtifacts(options, lookup);
};

export const waitForCrashArtifact = async ({
  lookup,
  options,
  getFallbackArtifact,
  recordArtifact,
}: WaitForCrashArtifactOptions): Promise<AppCrashDetails | null> => {
  const deadline = Date.now() + CRASH_ARTIFACT_WAIT_TIMEOUT_MS;
  let fallbackArtifact = getFallbackArtifact();

  while (Date.now() < deadline) {
    const artifacts = await collectCrashArtifacts(options, lookup);

    for (const artifact of artifacts) {
      recordArtifact(artifact);
    }

    const matchingArtifact = getBestMatchingArtifact({
      artifacts,
      options,
      lookup,
    });

    if (matchingArtifact) {
      return matchingArtifact;
    }

    fallbackArtifact = getFallbackArtifact();

    if (Date.now() >= deadline) {
      return fallbackArtifact;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, CRASH_ARTIFACT_POLL_INTERVAL_MS)
    );
  }

  return getFallbackArtifact() ?? fallbackArtifact;
};
