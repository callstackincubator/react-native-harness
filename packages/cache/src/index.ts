import fs from 'node:fs';
import { logger } from '@react-native-harness/tools';
import {
  createHarnessCachePaths,
  getDomainDirectories,
  type CacheDomainId,
  type HarnessCachePaths,
} from './paths.js';
import { isDomainWarm } from './warmth.js';

export type { CacheDomainId, HarnessCachePaths };

export interface HarnessCache {
  readonly paths: HarnessCachePaths;
  isWarm(domain: CacheDomainId): boolean;
  ensureDomainDirectories(domain: CacheDomainId): void;
}

const cacheLogger = logger.child('cache');

export const createHarnessCache = (options: {
  projectRoot: string;
}): HarnessCache => {
  const paths = createHarnessCachePaths(options.projectRoot);

  return {
    paths,
    isWarm: (domain) => isDomainWarm(domain, paths),
    ensureDomainDirectories: (domain) => {
      for (const directory of getDomainDirectories(domain, paths)) {
        try {
          fs.mkdirSync(directory, { recursive: true });
        } catch (error) {
          cacheLogger.warn(
            `Failed to create cache directory "${directory}". Continuing with a cold cache.`,
            error
          );
        }
      }
    },
  };
};
