import { CacheStore, MetroCache } from 'metro-cache';
import type { MixedOutput, TransformResult } from 'metro';
import fs from 'node:fs';
import path from 'node:path';
import type { CacheStoresConfigT } from 'metro-config';

const CACHE_ROOT = path.resolve(
  process.cwd(),
  'node_modules/.cache/rn-harness/metro-cache'
);

export const getHarnessCacheStores = (): ((
  metroCache: MetroCache
) => CacheStoresConfigT) => {
  return ({ FileStore }) => {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });

    return [
      new FileStore({ root: CACHE_ROOT }) as CacheStore<
        TransformResult<MixedOutput>
      >,
    ];
  };
};
