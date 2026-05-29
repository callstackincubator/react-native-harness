import type {
  AppCrashDetails,
  CrashArtifactWriter,
  CrashDetailsLookupOptions,
  CrashEnrichmentArtifact,
} from '@react-native-harness/platforms';
import { escapeRegExp, logger } from '@react-native-harness/tools';
import { androidCrashParser } from './crash-parser.js';

const crashDiagnosticsLogger = logger.child('android-crash-diagnostics');

const DROPBOX_ENTRY_HEADER =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?) (\S+) \(text, \d+ bytes\)/;
const DROPBOX_POLL_INTERVAL_MS = 1500;
const DROPBOX_WAIT_TIMEOUT_MS = 10000;

export const DROPBOX_CRASH_TAGS = [
  'data_app_crash',
  'data_app_native_crash',
] as const;

export type DropboxEntry = {
  tag: string;
  timestamp: string;
  content: string;
  pid?: number;
  processName?: string;
};

export type DropboxCrashArtifact = AppCrashDetails & {
  artifactType: 'dropbox-crash' | 'dropbox-native-crash';
  dropboxTag: string;
  occurredAt: number;
  score?: number;
};

type CollectDropboxArtifactsOptions = {
  bundleId: string;
  crashArtifactWriter?: CrashArtifactWriter;
  getDropboxOutput: () => Promise<string>;
  minOccurredAt?: number;
};

type WaitForDropboxArtifactsOptions = CollectDropboxArtifactsOptions &
  CrashDetailsLookupOptions;

const getDropboxArtifactType = (
  tag: string
): 'dropbox-crash' | 'dropbox-native-crash' =>
  tag === 'data_app_native_crash' ? 'dropbox-native-crash' : 'dropbox-crash';

const getDropboxFileName = (tag: string) =>
  tag === 'data_app_native_crash'
    ? 'dropbox-native-crash.txt'
    : 'dropbox-crash.txt';

const parseDropboxTimestamp = (timestamp: string): number => {
  const match = timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/
  );

  if (!match) {
    return 0;
  }

  const [, year, month, day, hour, minute, second, millis = '0'] = match;

  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millis)
  );
};

const extractDropboxPid = (content: string): number | undefined => {
  const match =
    content.match(/^PID:\s*(\d+)/m) ?? content.match(/\bpid:\s*(\d+)/im);

  return match ? Number(match[1]) : undefined;
};

const extractDropboxProcessName = (
  content: string,
  bundleId: string
): string | undefined => {
  const processMatch = content.match(/^Process:\s*(\S+)/m);
  const packageMatch = content.match(/^Package:\s*(\S+)/m);

  if (processMatch?.[1] === bundleId) {
    return processMatch[1];
  }

  if (packageMatch?.[1]?.startsWith(bundleId)) {
    return bundleId;
  }

  return content.includes(bundleId) ? bundleId : undefined;
};

export const parseDropboxOutput = (output: string): DropboxEntry[] => {
  if (output.trim() === '') {
    return [];
  }

  const sections = output.split(
    /^={10,}\s*$/m
  );
  const entries: DropboxEntry[] = [];

  for (const section of sections) {
    const trimmedSection = section.trim();

    if (trimmedSection === '') {
      continue;
    }

    const lines = trimmedSection.split('\n');
    const headerIndex = lines.findIndex((line) =>
      DROPBOX_ENTRY_HEADER.test(line.trim())
    );

    if (headerIndex === -1) {
      continue;
    }

    const headerMatch = lines[headerIndex].trim().match(DROPBOX_ENTRY_HEADER);

    if (!headerMatch) {
      continue;
    }

    const [, timestamp, tag] = headerMatch;
    const content = lines.slice(headerIndex + 1).join('\n').trim();

    if (content === '') {
      continue;
    }

    entries.push({
      tag,
      timestamp,
      content,
      pid: extractDropboxPid(content),
    });
  }

  return entries;
};

const matchesDropboxEntry = ({
  entry,
  bundleId,
  pid,
}: {
  entry: DropboxEntry;
  bundleId: string;
  pid?: number;
}) => {
  const processName = extractDropboxProcessName(entry.content, bundleId);

  if (!processName) {
    return false;
  }

  if (pid !== undefined && entry.pid !== undefined && entry.pid !== pid) {
    return false;
  }

  return true;
};

const scoreDropboxEntry = ({
  entry,
  bundleId,
  pid,
  occurredAt,
}: {
  entry: DropboxEntry;
  bundleId: string;
  pid?: number;
  occurredAt: number;
}): number => {
  let score = 0;

  if (extractDropboxProcessName(entry.content, bundleId) === bundleId) {
    score += 100;
  }

  if (pid !== undefined && entry.pid === pid) {
    score += 200;
  }

  const entryTimestamp = parseDropboxTimestamp(entry.timestamp);

  if (entryTimestamp > 0) {
    score -= Math.min(Math.abs(entryTimestamp - occurredAt) / 1000, 300);
  }

  if (entry.tag === 'data_app_native_crash') {
    score += 25;
  }

  return score;
};

const toDropboxCrashArtifact = ({
  entry,
  bundleId,
  pid,
  occurredAt,
  lookup,
}: {
  entry: DropboxEntry;
  bundleId: string;
  pid?: number;
  occurredAt: number;
  lookup?: CrashDetailsLookupOptions;
}): DropboxCrashArtifact => {
  const parsed = androidCrashParser.parse({
    contents: entry.content,
    bundleId,
    pid: pid ?? entry.pid,
  });
  const artifactType = getDropboxArtifactType(entry.tag);

  return {
    ...parsed,
    source: 'logs',
    summary: entry.content,
    rawLines: entry.content.split(/\r?\n/),
    artifactType,
    dropboxTag: entry.tag,
    occurredAt,
    score: scoreDropboxEntry({
      entry,
      bundleId,
      pid: lookup?.pid ?? pid,
      occurredAt: lookup?.occurredAt ?? occurredAt,
    }),
  };
};

const getMatchingDropboxEntries = ({
  output,
  bundleId,
  pid,
  occurredAt,
  minOccurredAt,
}: {
  output: string;
  bundleId: string;
  pid?: number;
  occurredAt: number;
  minOccurredAt?: number;
}) =>
  parseDropboxOutput(output)
    .filter((entry) => matchesDropboxEntry({ entry, bundleId, pid }))
    .filter((entry) => {
      const entryOccurredAt = parseDropboxTimestamp(entry.timestamp);

      return (
        minOccurredAt === undefined ||
        entryOccurredAt === 0 ||
        entryOccurredAt >= minOccurredAt
      );
    })
    .map((entry) =>
      toDropboxCrashArtifact({
        entry,
        bundleId,
        pid,
        occurredAt: parseDropboxTimestamp(entry.timestamp) || occurredAt,
      })
    )
    .sort((left, right) => {
      if ((right.score ?? 0) !== (left.score ?? 0)) {
        return (right.score ?? 0) - (left.score ?? 0);
      }

      return right.occurredAt - left.occurredAt;
    });

const persistDropboxArtifact = ({
  artifact,
  crashArtifactWriter,
  testFilePath,
}: {
  artifact: DropboxCrashArtifact;
  crashArtifactWriter?: CrashArtifactWriter;
  testFilePath?: string;
}): DropboxCrashArtifact => {
  if (!crashArtifactWriter) {
    return artifact;
  }

  return {
    ...artifact,
    artifactPath: crashArtifactWriter.persistArtifact({
      artifactKind: artifact.artifactType,
      testFilePath,
      source: {
        kind: 'text',
        fileName: getDropboxFileName(artifact.dropboxTag),
        text: `${artifact.summary ?? ''}\n`,
      },
    }),
  };
};

export const collectDropboxArtifacts = async ({
  bundleId,
  crashArtifactWriter,
  getDropboxOutput,
  minOccurredAt,
  ...lookup
}: WaitForDropboxArtifactsOptions): Promise<DropboxCrashArtifact[]> => {
  crashDiagnosticsLogger.debug('collecting dropbox crash artifacts: %o', {
    bundleId,
    pid: lookup.pid,
    occurredAt: lookup.occurredAt,
  });

  let output = '';

  try {
    output = await getDropboxOutput();
  } catch (error) {
    crashDiagnosticsLogger.debug('failed to read dropbox entries', error);
    return [];
  }

  return getMatchingDropboxEntries({
    output,
    bundleId,
    pid: lookup.pid,
    occurredAt: lookup.occurredAt,
    minOccurredAt,
  }).map((artifact) =>
    persistDropboxArtifact({
      artifact,
      crashArtifactWriter,
      testFilePath: lookup.testFilePath,
    })
  );
};

export const waitForDropboxArtifacts = async (
  options: WaitForDropboxArtifactsOptions
): Promise<DropboxCrashArtifact[]> => {
  const deadline = Date.now() + DROPBOX_WAIT_TIMEOUT_MS;
  let latestArtifacts: DropboxCrashArtifact[] = [];

  while (Date.now() < deadline) {
    latestArtifacts = await collectDropboxArtifacts(options);

    if (latestArtifacts.length > 0) {
      return latestArtifacts;
    }

    if (Date.now() >= deadline) {
      return latestArtifacts;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, DROPBOX_POLL_INTERVAL_MS)
    );
  }

  return latestArtifacts;
};

export const filterExitInfo = ({
  output,
  bundleId,
  pid,
}: {
  output: string;
  bundleId: string;
  pid?: number;
}): string | null => {
  if (output.trim() === '' || /No exit info records/i.test(output)) {
    return null;
  }

  const packagePattern = new RegExp(
    `\\bpackage=${escapeRegExp(bundleId)}\\b`,
    'i'
  );

  if (!packagePattern.test(output)) {
    return null;
  }

  const sections = output.split(/(?=ApplicationExitInfo\b)/);
  const matchingSections = sections.filter((section) => {
    if (!packagePattern.test(section)) {
      return false;
    }

    if (pid === undefined) {
      return true;
    }

    return new RegExp(`\\bpid=${pid}\\b`).test(section);
  });

  if (matchingSections.length === 0) {
    return packagePattern.test(output) ? output.trim() : null;
  }

  return matchingSections.join('\n').trim();
};

export const collectExitInfoArtifact = async ({
  bundleId,
  crashArtifactWriter,
  getExitInfo,
  pid,
  testFilePath,
}: {
  bundleId: string;
  crashArtifactWriter?: CrashArtifactWriter;
  getExitInfo: () => Promise<string>;
  pid?: number;
  testFilePath?: string;
}): Promise<CrashEnrichmentArtifact | null> => {
  let output = '';

  try {
    output = await getExitInfo();
  } catch (error) {
    crashDiagnosticsLogger.debug('failed to read activity exit-info', error);
    return null;
  }

  const filtered = filterExitInfo({ output, bundleId, pid });

  if (!filtered) {
    return null;
  }

  if (!crashArtifactWriter) {
    return {
      artifactType: 'exit-info',
      artifactPath: filtered,
    };
  }

  return {
    artifactType: 'exit-info',
    artifactPath: crashArtifactWriter.persistArtifact({
      artifactKind: 'exit-info',
      testFilePath,
      source: {
        kind: 'text',
        fileName: 'exit-info.txt',
        text: `${filtered}\n`,
      },
    }),
  };
};

export const getBestDropboxArtifact = (
  artifacts: DropboxCrashArtifact[]
): DropboxCrashArtifact | null =>
  [...artifacts].sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0] ??
  null;
