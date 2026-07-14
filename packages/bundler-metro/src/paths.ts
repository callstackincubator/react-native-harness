import path from 'node:path';

const HARNESS_DIRNAME = '.harness';
const MANIFEST_FILENAME = 'manifest.js';

export const getHarnessRootPath = (projectRoot = process.cwd()): string =>
  path.resolve(projectRoot, HARNESS_DIRNAME);

export const getHarnessManifestPath = (projectRoot = process.cwd()): string =>
  path.join(getHarnessRootPath(projectRoot), MANIFEST_FILENAME);
