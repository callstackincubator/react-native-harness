import fs from 'node:fs';
import path from 'node:path';

const getDefaultHarnessRoot = () => path.join(process.cwd(), '.harness');

const sanitizePathSegment = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'artifact';

const formatRunTimestamp = (value: Date) =>
  value.toISOString().replace(/[:.]/g, '-');

const isDefined = (value: string | undefined): value is string =>
  value !== undefined;

export const createHarnessArtifactDirectory = ({
  artifactType,
  bundleId,
  platformId,
  rootDir = getDefaultHarnessRoot(),
  runTimestamp = formatRunTimestamp(new Date()),
  runnerName,
}: {
  artifactType: string;
  bundleId?: string;
  platformId: string;
  rootDir?: string;
  runTimestamp?: string;
  runnerName: string;
}) => {
  const artifactRoot = path.join(rootDir, sanitizePathSegment(artifactType));
  const runDirName = [
    runTimestamp,
    platformId,
    runnerName,
    bundleId,
  ]
    .filter(isDefined)
    .map((value) => sanitizePathSegment(value))
    .join('--');
  const directoryPath = path.join(artifactRoot, runDirName);

  fs.mkdirSync(directoryPath, { recursive: true });

  return {
    directoryPath,
    rootDir: artifactRoot,
    runTimestamp,
  };
};
