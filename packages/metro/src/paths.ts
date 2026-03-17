import fs from 'node:fs';
import path from 'node:path';

const HARNESS_DIRNAME = '.harness';
const MANIFEST_FILENAME = 'manifest.js';
const METRO_CACHE_DIRNAME = 'metro-cache';

export const getHarnessRootPath = (projectRoot = process.cwd()): string =>
  path.resolve(projectRoot, HARNESS_DIRNAME);

export const getHarnessManifestPath = (projectRoot = process.cwd()): string =>
  path.join(getHarnessRootPath(projectRoot), MANIFEST_FILENAME);

export const getHarnessMetroCachePath = (
  projectRoot = process.cwd()
): string => path.join(getHarnessRootPath(projectRoot), METRO_CACHE_DIRNAME);

export const isMetroCacheReusable = (projectRoot = process.cwd()): boolean => {
  const metroCachePath = getHarnessMetroCachePath(projectRoot);

  try {
    const stat = fs.statSync(metroCachePath);

    if (!stat.isDirectory()) {
      return false;
    }

    return fs.readdirSync(metroCachePath).length > 0;
  } catch {
    return false;
  }
};
