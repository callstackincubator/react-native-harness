import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ARTIFACT_ROOT = path.join(
  process.cwd(),
  '.harness',
  'crash-reports'
);

const sanitizePathSegment = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'artifact';

const formatRunTimestamp = (value: Date) =>
  value.toISOString().replace(/[:.]/g, '-');

const getTargetFileName = ({
  platformId,
  artifactKind,
  source,
}: {
  platformId: string;
  artifactKind: string;
  source:
    | {
        kind: 'file';
        path: string;
      }
    | {
        kind: 'text';
        fileName: string;
      };
}) => {
  const originalName =
    source.kind === 'file' ? path.basename(source.path) : source.fileName;

  return [
    sanitizePathSegment(platformId),
    sanitizePathSegment(artifactKind),
    sanitizePathSegment(originalName),
  ].join('--');
};

const getTestFileSegment = (testFilePath?: string) => {
  if (!testFilePath) {
    return 'unscoped';
  }

  const resolvedTestFilePath = path.resolve(testFilePath);
  const relativeTestFilePath = path.relative(
    process.cwd(),
    resolvedTestFilePath
  );

  return sanitizePathSegment(
    relativeTestFilePath.startsWith('..') ||
      path.isAbsolute(relativeTestFilePath)
      ? resolvedTestFilePath
      : relativeTestFilePath
  );
};

const getDeduplicationKey = ({
  platformId,
  artifactKind,
  testFilePath,
  source,
}: {
  platformId: string;
  artifactKind: string;
  testFilePath?: string;
  source:
    | {
        kind: 'file';
        path: string;
      }
    | {
        kind: 'text';
        fileName: string;
        text: string;
      };
}) => {
  if (source.kind === 'file') {
    return `file:${platformId}:${artifactKind}:${
      testFilePath ?? ''
    }:${path.resolve(source.path)}`;
  }

  return `text:${platformId}:${artifactKind}:${testFilePath ?? ''}:${
    source.fileName
  }:${source.text}`;
};

export const createCrashArtifactWriter = ({
  runnerName,
  platformId,
  rootDir = DEFAULT_ARTIFACT_ROOT,
  runTimestamp = formatRunTimestamp(new Date()),
}: {
  runnerName: string;
  platformId: string;
  rootDir?: string;
  runTimestamp?: string;
}) => {
  const persistedArtifacts = new Map<string, string>();

  return {
    runTimestamp,
    persistArtifact: (options: {
      artifactKind: string;
      testFilePath?: string;
      source:
        | {
            kind: 'file';
            path: string;
          }
        | {
            kind: 'text';
            fileName: string;
            text: string;
          };
    }) => {
      const deduplicationKey = getDeduplicationKey({
        platformId,
        artifactKind: options.artifactKind,
        testFilePath: options.testFilePath,
        source: options.source,
      });
      const existingPath = persistedArtifacts.get(deduplicationKey);

      if (existingPath) {
        return existingPath;
      }

      fs.mkdirSync(rootDir, { recursive: true });

      const targetDir = path.join(
        rootDir,
        sanitizePathSegment(runTimestamp),
        sanitizePathSegment(runnerName),
        getTestFileSegment(options.testFilePath)
      );
      const targetPath = path.join(
        targetDir,
        getTargetFileName({
          platformId,
          artifactKind: options.artifactKind,
          source: options.source,
        })
      );

      fs.mkdirSync(targetDir, { recursive: true });

      if (options.source.kind === 'file') {
        fs.copyFileSync(options.source.path, targetPath);
      } else {
        fs.writeFileSync(targetPath, options.source.text, 'utf8');
      }

      persistedArtifacts.set(deduplicationKey, targetPath);

      return targetPath;
    },
  };
};
