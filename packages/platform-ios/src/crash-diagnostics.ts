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

const crashDiagnosticsLogger = logger.child('ios-crash-diagnostics');

const CRASH_ARTIFACT_WAIT_TIMEOUT_MS = 10000;
const CRASH_ARTIFACT_POLL_INTERVAL_MS = 250;

type CollectIosCrashArtifactsOptions = {
  processNames: string[];
  bundleId: string;
  crashArtifactWriter?: CrashArtifactWriter;
  minOccurredAt?: number;
  maxOccurredAt?: number;
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

type CrashArtifactCollector = {
  name: string;
  collect: () =>
    | Promise<CrashArtifactCollectorResult>
    | CrashArtifactCollectorResult;
};

type CrashArtifactCollectorDiagnostics = {
  source: string;
  root?: string;
  totalFiles?: number;
  matchingFiles?: number;
  copiedFiles?: number;
  parseFailures?: number;
  skippedBeforeMin?: number;
  skippedAfterMax?: number;
  skippedTarget?: number;
  accepted?: number;
};

type CrashArtifactCollectorResult = {
  artifacts: DiagnosedCrashArtifact[];
  diagnostics: CrashArtifactCollectorDiagnostics;
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

const getDiagnosticReportsDir = () =>
  process.env.RN_HARNESS_IOS_DIAGNOSTIC_REPORTS_DIR ??
  join(homedir(), 'Library', 'Logs', 'DiagnosticReports');

const getBestScore = (
  artifacts: DiagnosedCrashArtifact[],
  options: CollectCrashArtifactsOptions,
  lookup?: CrashDetailsLookupOptions
) =>
  artifacts.reduce<number | undefined>((bestScore, artifact) => {
    const score = scoreCrashArtifact({ artifact, options, lookup });

    if (score <= 0) {
      return bestScore;
    }

    return bestScore === undefined ? score : Math.max(bestScore, score);
  }, undefined);

const createCollectionLogPayload = ({
  diagnostics,
  artifacts,
  options,
  lookup,
  polls,
}: {
  diagnostics: CrashArtifactCollectorDiagnostics;
  artifacts: DiagnosedCrashArtifact[];
  options: CollectCrashArtifactsOptions;
  lookup?: CrashDetailsLookupOptions;
  polls?: number;
}) => ({
  source: diagnostics.source,
  root: diagnostics.root,
  targetType: options.targetType,
  targetId: options.targetId,
  processNames: options.processNames,
  minOccurredAt: options.minOccurredAt,
  maxOccurredAt: options.maxOccurredAt,
  lookupOccurredAt: lookup?.occurredAt,
  lookupPid: lookup?.pid,
  lookupProcessName: lookup?.processName,
  polls,
  totalFiles: diagnostics.totalFiles ?? 0,
  matchingFiles: diagnostics.matchingFiles ?? 0,
  copiedFiles: diagnostics.copiedFiles,
  parseFailures: diagnostics.parseFailures ?? 0,
  skippedBeforeMin: diagnostics.skippedBeforeMin ?? 0,
  skippedAfterMax: diagnostics.skippedAfterMax ?? 0,
  skippedTarget: diagnostics.skippedTarget ?? 0,
  accepted: diagnostics.accepted ?? 0,
  scoredMatches: artifacts.filter(
    (artifact) => scoreCrashArtifact({ artifact, options, lookup }) > 0
  ).length,
  bestScore: getBestScore(artifacts, options, lookup),
});

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

  if (
    lookup?.minOccurredAt !== undefined &&
    artifact.occurredAt < lookup.minOccurredAt
  ) {
    return -1;
  }

  if (
    lookup?.maxOccurredAt !== undefined &&
    artifact.occurredAt > lookup.maxOccurredAt
  ) {
    return -1;
  }

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
}): CrashArtifactCollectorResult => {
  const diagnostics: CrashArtifactCollectorDiagnostics = {
    source: 'copied crash logs',
    root: rootDir,
    totalFiles: 0,
    matchingFiles: 0,
    parseFailures: 0,
    skippedBeforeMin: 0,
    skippedAfterMax: 0,
    accepted: 0,
  };
  const candidates = collectFilesRecursively(rootDir).filter(isCrashReportFile);
  diagnostics.totalFiles = candidates.length;
  diagnostics.matchingFiles = candidates.length;

  const artifacts = candidates
    .map((path) => {
      const contents = fs.readFileSync(path, 'utf8');
      const parsed = iosCrashParser.parse({ path, contents });

      if (!parsed) {
        diagnostics.parseFailures = (diagnostics.parseFailures ?? 0) + 1;
        return null;
      }

      if (
        options.minOccurredAt !== undefined &&
        parsed.occurredAt < options.minOccurredAt
      ) {
        diagnostics.skippedBeforeMin = (diagnostics.skippedBeforeMin ?? 0) + 1;
        return null;
      }

      if (
        options.maxOccurredAt !== undefined &&
        parsed.occurredAt > options.maxOccurredAt
      ) {
        diagnostics.skippedAfterMax = (diagnostics.skippedAfterMax ?? 0) + 1;
        return null;
      }

      const artifactPath = options.crashArtifactWriter
        ? options.crashArtifactWriter.persistArtifact({
            artifactKind: 'ios-crash-report',
            source: {
              kind: 'file',
              path,
            },
          })
        : path;

      const artifact: DiagnosedCrashArtifact = {
        ...parsed,
        artifactType: 'ios-crash-report',
        artifactPath,
        occurredAt: parsed.occurredAt,
      };

      artifact.score = scoreCrashArtifact({ artifact, options, lookup });
      diagnostics.accepted = (diagnostics.accepted ?? 0) + 1;
      return artifact;
    })
    .filter((artifact): artifact is DiagnosedCrashArtifact =>
      Boolean(artifact)
    );

  return {
    artifacts: artifacts.sort((left, right) => {
      if ((right.score ?? 0) !== (left.score ?? 0)) {
        return (right.score ?? 0) - (left.score ?? 0);
      }

      return right.occurredAt - left.occurredAt;
    }),
    diagnostics,
  };
};

const collectSimulatorCrashArtifacts = async ({
  targetId,
  processNames,
  bundleId,
  crashArtifactWriter,
  minOccurredAt,
  maxOccurredAt,
}: CollectSimulatorCrashArtifactsOptions) => {
  // Do not fall back to `simctl diagnose` here. It collects broad simulator
  // diagnostics, not just this app's crash report, and can block long enough
  // to trip Harness/Jest timeouts on CI. Simulator crash reports are therefore
  // best-effort from host DiagnosticReports only.
  return collectCrashArtifactsFromDiagnosticReports({
    targetId,
    targetType: 'simulator',
    processNames,
    bundleId,
    crashArtifactWriter,
    minOccurredAt,
    maxOccurredAt,
  });
};

const collectCrashArtifactsFromDiagnosticReports = (
  options: CollectCrashArtifactsOptions
): CrashArtifactCollectorResult => {
  const diagnosticReportsDir = getDiagnosticReportsDir();
  const diagnostics: CrashArtifactCollectorDiagnostics = {
    source: 'host DiagnosticReports',
    root: diagnosticReportsDir,
    totalFiles: 0,
    matchingFiles: 0,
    parseFailures: 0,
    skippedBeforeMin: 0,
    skippedAfterMax: 0,
    skippedTarget: 0,
    accepted: 0,
  };

  if (!fs.existsSync(diagnosticReportsDir)) {
    return { artifacts: [], diagnostics };
  }

  const allIpsEntries = fs
    .readdirSync(diagnosticReportsDir)
    .filter((entry) => entry.endsWith('.ips'));
  const matchingEntries = allIpsEntries.filter((entry) =>
    options.processNames.some((name) => entry.startsWith(`${name}-`))
  );
  diagnostics.totalFiles = allIpsEntries.length;
  diagnostics.matchingFiles = matchingEntries.length;

  const artifacts: DiagnosedCrashArtifact[] = [];

  for (const entry of matchingEntries) {
    const path = join(diagnosticReportsDir, entry);
    const contents = fs.readFileSync(path, 'utf8');
    const parsed = iosCrashParser.parse({ path, contents });

    if (!parsed) {
      diagnostics.parseFailures = (diagnostics.parseFailures ?? 0) + 1;
      continue;
    }

    if (
      options.minOccurredAt !== undefined &&
      parsed.occurredAt < options.minOccurredAt
    ) {
      diagnostics.skippedBeforeMin = (diagnostics.skippedBeforeMin ?? 0) + 1;
      continue;
    }

    if (
      options.maxOccurredAt !== undefined &&
      parsed.occurredAt > options.maxOccurredAt
    ) {
      diagnostics.skippedAfterMax = (diagnostics.skippedAfterMax ?? 0) + 1;
      continue;
    }

    if (
      options.targetType === 'simulator' &&
      parsed.targetId !== undefined &&
      parsed.targetId !== options.targetId
    ) {
      diagnostics.skippedTarget = (diagnostics.skippedTarget ?? 0) + 1;
      continue;
    }

    const artifactPath = options.crashArtifactWriter
      ? options.crashArtifactWriter.persistArtifact({
          artifactKind: 'ios-crash-report',
          source: { kind: 'file', path },
        })
      : path;

    const artifact: DiagnosedCrashArtifact = {
      ...parsed,
      artifactType: 'ios-crash-report',
      artifactPath,
      occurredAt: parsed.occurredAt,
    };

    artifact.score = scoreCrashArtifact({ artifact, options });
    diagnostics.accepted = (diagnostics.accepted ?? 0) + 1;
    artifacts.push(artifact);
  }

  return {
    artifacts: artifacts.sort((left, right) => {
      if ((right.score ?? 0) !== (left.score ?? 0)) {
        return (right.score ?? 0) - (left.score ?? 0);
      }

      return right.occurredAt - left.occurredAt;
    }),
    diagnostics,
  };
};

const collectPhysicalCrashArtifactsFromDevice = async ({
  targetId,
  processNames,
  bundleId,
  crashArtifactWriter,
  minOccurredAt,
  maxOccurredAt,
}: CollectPhysicalCrashArtifactsOptions): Promise<CrashArtifactCollectorResult> => {
  const crashLogsDir = createTempDirectory('rn-harness-devicectl-crash-logs');
  const diagnostics: CrashArtifactCollectorDiagnostics = {
    source: 'device systemCrashLogs',
    root: crashLogsDir,
    totalFiles: 0,
    matchingFiles: 0,
    copiedFiles: 0,
    parseFailures: 0,
    skippedBeforeMin: 0,
    skippedAfterMax: 0,
    accepted: 0,
  };

  try {
    const remoteCrashLogPaths = await devicectl.listFiles(targetId, {
      domainType: 'systemCrashLogs',
      recursive: true,
    });
    diagnostics.totalFiles = remoteCrashLogPaths.length;
    const filteredCrashLogPaths = remoteCrashLogPaths.filter((remotePath) =>
      processNames.some((processName) => remotePath.includes(processName))
    );
    diagnostics.matchingFiles = filteredCrashLogPaths.length;

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
        diagnostics.copiedFiles = (diagnostics.copiedFiles ?? 0) + 1;
      }

      const copiedArtifacts = parseCrashArtifacts({
        rootDir: crashLogsDir,
        options: {
          targetId,
          targetType: 'device',
          processNames,
          bundleId,
          crashArtifactWriter,
          minOccurredAt,
          maxOccurredAt,
        },
      });

      copiedArtifacts.diagnostics.source = diagnostics.source;
      copiedArtifacts.diagnostics.root = diagnostics.root;
      copiedArtifacts.diagnostics.totalFiles = diagnostics.totalFiles;
      copiedArtifacts.diagnostics.matchingFiles = diagnostics.matchingFiles;
      copiedArtifacts.diagnostics.copiedFiles = diagnostics.copiedFiles;

      if (copiedArtifacts.artifacts.length > 0) {
        return copiedArtifacts;
      }
    }
  } finally {
    fs.rmSync(crashLogsDir, { recursive: true, force: true });
  }

  return { artifacts: [], diagnostics };
};

const createCrashArtifactCollectors = (
  options: CollectCrashArtifactsOptions
): CrashArtifactCollector[] => {
  if (options.targetType === 'simulator') {
    return [
      {
        name: 'host DiagnosticReports',
        collect: () => collectSimulatorCrashArtifacts(options),
      },
    ];
  }

  return [
    {
      name: 'device systemCrashLogs',
      collect: () =>
        collectPhysicalCrashArtifactsFromDevice({
          targetId: options.targetId,
          targetType: 'device',
          processNames: options.processNames,
          bundleId: options.bundleId,
          crashArtifactWriter: options.crashArtifactWriter,
          minOccurredAt: options.minOccurredAt,
          maxOccurredAt: options.maxOccurredAt,
        }),
    },
    {
      name: 'host DiagnosticReports',
      collect: () =>
        collectCrashArtifactsFromDiagnosticReports({
          targetId: options.targetId,
          targetType: 'device',
          processNames: options.processNames,
          bundleId: options.bundleId,
          crashArtifactWriter: options.crashArtifactWriter,
          minOccurredAt: options.minOccurredAt,
          maxOccurredAt: options.maxOccurredAt,
        }),
    },
  ];
};

export const collectCrashArtifacts = async (
  options: CollectCrashArtifactsOptions
): Promise<DiagnosedCrashArtifact[]> => {
  crashDiagnosticsLogger.debug('collecting crash artifacts: %o', {
    targetId: options.targetId,
    targetType: options.targetType,
    processNames: options.processNames,
    minOccurredAt: options.minOccurredAt,
    maxOccurredAt: options.maxOccurredAt,
  });

  const results = await Promise.allSettled(
    createCrashArtifactCollectors(options).map(async (collector) => ({
      name: collector.name,
      result: await collector.collect(),
    }))
  );

  const artifacts: DiagnosedCrashArtifact[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const collectorArtifacts = result.value.result.artifacts;
      artifacts.push(...collectorArtifacts);
      crashDiagnosticsLogger.debug(
        'crash artifact collector summary: %o',
        createCollectionLogPayload({
          diagnostics: result.value.result.diagnostics,
          artifacts: collectorArtifacts,
          options,
        })
      );
      continue;
    }

    crashDiagnosticsLogger.debug(
      'crash artifact collector failed',
      result.reason
    );
  }

  return artifacts.sort((left, right) => {
    if ((right.score ?? 0) !== (left.score ?? 0)) {
      return (right.score ?? 0) - (left.score ?? 0);
    }

    return right.occurredAt - left.occurredAt;
  });
};

export const waitForCrashArtifact = async ({
  lookup,
  options,
  getFallbackArtifact,
  recordArtifact,
}: WaitForCrashArtifactOptions): Promise<AppCrashDetails | null> => {
  const deadline = Date.now() + CRASH_ARTIFACT_WAIT_TIMEOUT_MS;
  let fallbackArtifact = getFallbackArtifact();
  let settled = false;
  const collectorDiagnostics = new Map<
    string,
    {
      polls: number;
      artifacts: DiagnosedCrashArtifact[];
      diagnostics: CrashArtifactCollectorDiagnostics;
    }
  >();

  crashDiagnosticsLogger.debug('waiting for crash artifact: %o', {
    targetId: options.targetId,
    targetType: options.targetType,
    processNames: options.processNames,
    minOccurredAt: options.minOccurredAt,
    maxOccurredAt: options.maxOccurredAt,
    lookupOccurredAt: lookup.occurredAt,
    lookupPid: lookup.pid,
    lookupProcessName: lookup.processName,
  });

  const waitForNextPoll = async () => {
    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
      return;
    }

    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(CRASH_ARTIFACT_POLL_INTERVAL_MS, remainingMs)
      )
    );
  };

  const pollCollector = async (
    collector: CrashArtifactCollector
  ): Promise<AppCrashDetails | null> => {
    while (!settled && Date.now() < deadline) {
      try {
        const result = await collector.collect();
        const artifacts = result.artifacts;
        const previousDiagnostics = collectorDiagnostics.get(collector.name);
        collectorDiagnostics.set(collector.name, {
          polls: (previousDiagnostics?.polls ?? 0) + 1,
          artifacts,
          diagnostics: result.diagnostics,
        });

        for (const artifact of artifacts) {
          recordArtifact(artifact);
        }

        const matchingArtifact = getBestMatchingArtifact({
          artifacts,
          options,
          lookup,
        });

        if (matchingArtifact) {
          crashDiagnosticsLogger.debug(
            'matched crash artifact from %s: %o',
            collector.name,
            {
              artifactPath: matchingArtifact.artifactPath,
              processName: matchingArtifact.processName,
              pid: matchingArtifact.pid,
              occurredAt: matchingArtifact.occurredAt,
              signal: matchingArtifact.signal,
              exceptionType: matchingArtifact.exceptionType,
              score: scoreCrashArtifact({
                artifact: matchingArtifact,
                options,
                lookup,
              }),
            }
          );
          return matchingArtifact;
        }
      } catch (error) {
        crashDiagnosticsLogger.debug(
          '%s crash artifact collector failed',
          collector.name,
          error
        );
      }

      fallbackArtifact = getFallbackArtifact();
      await waitForNextPoll();
    }

    return null;
  };

  const collectors = createCrashArtifactCollectors(options);
  const foundArtifact = new Promise<AppCrashDetails | null>((resolve) => {
    let pendingCollectors = collectors.length;

    for (const collector of collectors) {
      void pollCollector(collector).then((artifact) => {
        if (settled) {
          return;
        }

        if (artifact) {
          settled = true;
          resolve(artifact);
          return;
        }

        pendingCollectors -= 1;

        if (pendingCollectors === 0) {
          settled = true;
          resolve(getFallbackArtifact() ?? fallbackArtifact);
        }
      });
    }
  });

  const timeout = new Promise<AppCrashDetails | null>((resolve) => {
    setTimeout(() => {
      settled = true;
      resolve(getFallbackArtifact() ?? fallbackArtifact);
    }, CRASH_ARTIFACT_WAIT_TIMEOUT_MS);
  });

  const artifact = await Promise.race([foundArtifact, timeout]);

  if (artifact?.artifactType !== 'ios-crash-report') {
    crashDiagnosticsLogger.debug(
      'crash artifact lookup finished without report'
    );

    for (const diagnostics of collectorDiagnostics.values()) {
      crashDiagnosticsLogger.debug(
        'crash artifact collector summary: %o',
        createCollectionLogPayload({
          diagnostics: diagnostics.diagnostics,
          artifacts: diagnostics.artifacts,
          options,
          lookup,
          polls: diagnostics.polls,
        })
      );
    }
  }

  return artifact;
};
