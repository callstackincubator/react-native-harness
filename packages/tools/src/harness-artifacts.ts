import fs from 'node:fs';
import path from 'node:path';

export const getHarnessRootPath = (projectRoot = process.cwd()) =>
  path.join(projectRoot, '.harness');

export const getHarnessCacheRootPath = (projectRoot = process.cwd()) =>
  path.join(getHarnessRootPath(projectRoot), 'cache');

export const getHarnessCacheArtifactPath = (
  artifactName: string,
  projectRoot = process.cwd()
) =>
  path.join(
    getHarnessCacheRootPath(projectRoot),
    sanitizePathSegment(artifactName)
  );

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
  rootDir = getHarnessRootPath(),
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
  const runDirName = [runTimestamp, platformId, runnerName, bundleId]
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
