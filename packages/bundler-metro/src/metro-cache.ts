import fs from 'node:fs';
import type { CacheStoresConfigT } from 'metro-config';
import { CacheStore, MetroCache } from 'metro-cache';
import type { MixedOutput, TransformResult } from 'metro';
import { getHarnessMetroCachePath } from './paths.js';

export const getHarnessCacheStores = (): ((
  metroCache: MetroCache
) => CacheStoresConfigT) => {
  return ({ FileStore }) => {
    const cacheRoot = getHarnessMetroCachePath();

    fs.mkdirSync(cacheRoot, { recursive: true });

    return [
      new FileStore({ root: cacheRoot }) as CacheStore<
        TransformResult<MixedOutput>
      >,
    ];
  };
};
