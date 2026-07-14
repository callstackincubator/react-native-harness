import fs from 'node:fs';
import { logger } from '@react-native-harness/tools';
import {
  createHarnessCachePaths,
  getDomainDirectories,
  type CacheDomainId,
  type HarnessCachePaths,
} from './paths.js';
import {
  planRestore,
  planSave,
  snapshot,
  writeKeysFile,
  type CacheKeyInputs,
  type CacheSnapshot,
  type CacheSnapshotEntry,
  type DomainRestorePlan,
  type DomainSavePlan,
  type RestorePlan,
  type SavePlan,
  type SavePolicy,
} from './plan.js';
import { isDomainWarm } from './warmth.js';
import { computeMetroStaticInputs, METRO_KEY_FILENAMES } from './domains/metro.js';

export { computeMetroStaticInputs, METRO_KEY_FILENAMES };

export type { CacheDomainId, HarnessCachePaths };
export type {
  CacheKeyInputs,
  CacheSnapshot,
  CacheSnapshotEntry,
  DomainRestorePlan,
  DomainSavePlan,
  RestorePlan,
  SavePlan,
  SavePolicy,
};

export interface HarnessCache {
  readonly paths: HarnessCachePaths;
  isWarm(domain: CacheDomainId): boolean;
  ensureDomainDirectories(domain: CacheDomainId): void;
  planRestore(
    inputs: Partial<Record<CacheDomainId, CacheKeyInputs>>
  ): RestorePlan;
  snapshot(): CacheSnapshot;
  planSave(
    before: CacheSnapshot,
    policy: SavePolicy,
    inputs: Partial<Record<CacheDomainId, CacheKeyInputs>>
  ): SavePlan;
  writeKeysFile(plan: RestorePlan | SavePlan): void;
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
    planRestore: (inputs) => planRestore(paths, inputs),
    snapshot: () => snapshot(paths),
    planSave: (before, policy, inputs) =>
      planSave(paths, before, policy, inputs),
    writeKeysFile: (plan) => writeKeysFile(paths, plan),
  };
};
