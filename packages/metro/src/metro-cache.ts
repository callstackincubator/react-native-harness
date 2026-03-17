import { CacheStore, MetroCache } from 'metro-cache';
import type { MixedOutput, TransformResult } from 'metro';
import fs from 'node:fs';
import type { CacheStoresConfigT } from 'metro-config';
import { getHarnessMetroCachePath } from './paths';

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
