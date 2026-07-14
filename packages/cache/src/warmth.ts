import fs from 'node:fs';
import { logger } from '@react-native-harness/tools';
import type { CacheDomainId, HarnessCachePaths } from './paths.js';

const cacheLogger = logger.child('cache');

/**
 * A domain is warm when its cache directory exists and is non-empty. Cache
 * I/O must never fail a run, so any error while inspecting the filesystem is
 * logged and treated as cold.
 */
export const isDomainWarm = (
  domain: CacheDomainId,
  paths: HarnessCachePaths
): boolean => {
  const directory = getWarmthDirectory(domain, paths);

  if (!directory) {
    return false;
  }

  try {
    const stat = fs.statSync(directory);

    if (!stat.isDirectory()) {
      return false;
    }

    return fs.readdirSync(directory).length > 0;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    cacheLogger.warn(
      `Failed to check cache warmth for "${domain}" at "${directory}". Treating as cold.`,
      error
    );
    return false;
  }
};

const getWarmthDirectory = (
  domain: CacheDomainId,
  paths: HarnessCachePaths
): string | undefined => {
  switch (domain) {
    case 'metro':
      return paths.metroTransform;
    default:
      return undefined;
  }
};

const isMissingPathError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 'ENOENT';
