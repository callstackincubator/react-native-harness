import type {
  AppCrashDetails,
  AppSessionLog,
  CrashArtifactWriter,
  CrashDetailsLookupOptions,
  CrashEnrichmentArtifact,
} from '@react-native-harness/platforms';
import { androidCrashParser } from './crash-parser.js';
import {
  collectExitInfoArtifact,
  waitForDropboxArtifacts,
  getBestDropboxArtifact,
  type DropboxCrashArtifact,
} from './crash-diagnostics.js';

const CRASH_ARTIFACT_SETTLE_DELAY_MS = 100;
const CRASH_BLOCK_HEADER = '--------- beginning of crash';
const CRASH_LOG_WINDOW_MS = 5000;

const findCrashBlockStart = (lines: string[]) => {
  let latestCrashHeaderIndex = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (
      /FATAL EXCEPTION:|Process:\s+.+,\s+PID:|>>>\s+.+\s+<<</i.test(
        lines[index]
      )
    ) {
      latestCrashHeaderIndex = index;
      break;
    }
  }

  const latestBlockHeaderIndex = lines.lastIndexOf(CRASH_BLOCK_HEADER);

  return latestBlockHeaderIndex >= 0
    ? latestBlockHeaderIndex
    : latestCrashHeaderIndex;
};

const getCrashBlock = (logs: AppSessionLog[], occurredAt: number) => {
  const nearbyLogs = logs.filter(
    (log) => Math.abs(log.occurredAt - occurredAt) <= CRASH_LOG_WINDOW_MS
  );
  const lines =
    nearbyLogs.length > 0
      ? nearbyLogs.map((log) => log.line)
      : logs.map((log) => log.line);
  const blockStart = findCrashBlockStart(lines);

  return blockStart >= 0 ? lines.slice(blockStart) : lines;
};

const hasUsefulLogcatBlock = (rawLines: string[]) =>
  rawLines.some((line) =>
    /FATAL EXCEPTION:|Process:\s+.+,\s+PID:|>>>\s+.+\s+<<</i.test(line)
  );

const getLogcatCrashDetails = ({
  rawLines,
  bundleId,
  pid,
}: {
  rawLines: string[];
  bundleId: string;
  pid?: number;
}): AppCrashDetails => ({
  ...androidCrashParser.parse({
    contents: rawLines.join('\n'),
    bundleId,
    pid,
  }),
  artifactType: 'logcat',
  rawLines,
});

const persistLogcatArtifact = ({
  details,
  crashArtifactWriter,
  testFilePath,
}: {
  details: AppCrashDetails;
  crashArtifactWriter?: CrashArtifactWriter;
  testFilePath?: string;
}): AppCrashDetails => {
  if (!crashArtifactWriter || !details.rawLines?.length) {
    return details;
  }

  return {
    ...details,
    artifactPath: crashArtifactWriter.persistArtifact({
      artifactKind: 'logcat',
      testFilePath,
      source: {
        kind: 'text',
        fileName: 'logcat.txt',
        text: `${details.rawLines.join('\n')}\n`,
      },
    }),
  };
};

const getDropboxFallbackDetails = (
  artifact: DropboxCrashArtifact
): AppCrashDetails => ({
  ...artifact,
  artifactType: artifact.artifactType,
  artifactPath: artifact.artifactPath,
});

const getEnrichmentArtifacts = async ({
  bundleId,
  crashArtifactWriter,
  getDropboxOutput,
  getExitInfo,
  minOccurredAt,
  occurredAt,
  pid,
  testFilePath,
}: {
  bundleId: string;
  crashArtifactWriter?: CrashArtifactWriter;
  getDropboxOutput?: () => Promise<string>;
  getExitInfo?: () => Promise<string>;
  minOccurredAt?: number;
  occurredAt: number;
  pid?: number;
  testFilePath?: string;
}): Promise<{
  dropboxArtifacts: DropboxCrashArtifact[];
  enrichmentArtifacts: CrashEnrichmentArtifact[];
}> => {
  const dropboxArtifacts = getDropboxOutput
    ? await waitForDropboxArtifacts({
        bundleId,
        crashArtifactWriter,
        getDropboxOutput,
        minOccurredAt,
        occurredAt,
        pid,
        testFilePath,
      })
    : [];

  const enrichmentArtifacts: CrashEnrichmentArtifact[] = dropboxArtifacts
    .filter((artifact) => artifact.artifactPath !== undefined)
    .map((artifact) => ({
      artifactType: artifact.artifactType,
      artifactPath: artifact.artifactPath as string,
    }));

  if (getExitInfo) {
    const exitInfoArtifact = await collectExitInfoArtifact({
      bundleId,
      crashArtifactWriter,
      getExitInfo,
      pid,
      testFilePath,
    });

    if (exitInfoArtifact?.artifactPath.startsWith('/')) {
      enrichmentArtifacts.push({
        artifactType: exitInfoArtifact.artifactType,
        artifactPath: exitInfoArtifact.artifactPath,
      });
    }
  }

  return { dropboxArtifacts, enrichmentArtifacts };
};

export const createAndroidCrashReporter = ({
  bundleId,
  crashArtifactWriter,
  getLogs,
  getDropboxOutput,
  getExitInfo,
  minOccurredAt,
}: {
  bundleId: string;
  crashArtifactWriter?: CrashArtifactWriter;
  getLogs: () => AppSessionLog[];
  getDropboxOutput?: () => Promise<string>;
  getExitInfo?: () => Promise<string>;
  minOccurredAt?: number;
}) => ({
  getCrashDetails: async ({
    occurredAt,
    pid,
    testFilePath,
  }: CrashDetailsLookupOptions): Promise<AppCrashDetails | null> => {
    await new Promise((resolve) =>
      setTimeout(resolve, CRASH_ARTIFACT_SETTLE_DELAY_MS)
    );

    const rawLines = getCrashBlock(getLogs(), occurredAt);
    const logcatDetails =
      rawLines.length > 0
        ? getLogcatCrashDetails({ rawLines, bundleId, pid })
        : null;

    let enrichmentArtifacts: CrashEnrichmentArtifact[] = [];
    let dropboxArtifacts: DropboxCrashArtifact[] = [];

    if (getDropboxOutput || getExitInfo) {
      ({ dropboxArtifacts, enrichmentArtifacts } =
        await getEnrichmentArtifacts({
          bundleId,
          crashArtifactWriter,
          getDropboxOutput,
          getExitInfo,
          minOccurredAt,
          occurredAt,
          pid,
          testFilePath,
        }));
    }

    if (logcatDetails && hasUsefulLogcatBlock(rawLines)) {
      return {
        ...persistLogcatArtifact({
          details: logcatDetails,
          crashArtifactWriter,
          testFilePath,
        }),
        enrichmentArtifacts:
          enrichmentArtifacts.length > 0 ? enrichmentArtifacts : undefined,
      };
    }

    const dropboxFallback = getBestDropboxArtifact(dropboxArtifacts);

    if (dropboxFallback) {
      const primary = getDropboxFallbackDetails(dropboxFallback);

      return {
        ...primary,
        enrichmentArtifacts: enrichmentArtifacts.filter(
          (artifact) => artifact.artifactPath !== primary.artifactPath
        ),
      };
    }

    if (logcatDetails) {
      return {
        ...persistLogcatArtifact({
          details: logcatDetails,
          crashArtifactWriter,
          testFilePath,
        }),
        enrichmentArtifacts:
          enrichmentArtifacts.length > 0 ? enrichmentArtifacts : undefined,
      };
    }

    return enrichmentArtifacts.length > 0
      ? {
          enrichmentArtifacts,
        }
      : null;
  },
});
