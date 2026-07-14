import path from 'node:path';

const HARNESS_DIRNAME = '.harness';
const CACHE_DIRNAME = 'cache';
const METRO_TRANSFORM_DIRNAME = 'metro';
const METRO_FILE_MAP_DIRNAME = 'metro-file-map';

export type CacheDomainId = 'metro';

export interface HarnessCachePaths {
  readonly root: string;
  readonly metroTransform: string;
  readonly metroFileMap: string;
}

export const createHarnessCachePaths = (
  projectRoot: string
): HarnessCachePaths => {
  const root = path.join(projectRoot, HARNESS_DIRNAME, CACHE_DIRNAME);

  return {
    root,
    metroTransform: path.join(root, METRO_TRANSFORM_DIRNAME),
    metroFileMap: path.join(root, METRO_FILE_MAP_DIRNAME),
  };
};

/**
 * Directories that make up a cache domain. `metro` covers both the transform
 * cache and the file-map (haste) cache so `ensureDomainDirectories` prepares
 * both ahead of a run.
 */
export const getDomainDirectories = (
  domain: CacheDomainId,
  paths: HarnessCachePaths
): readonly string[] => {
  switch (domain) {
    case 'metro':
      return [paths.metroTransform, paths.metroFileMap];
    default:
      return [];
  }
};
