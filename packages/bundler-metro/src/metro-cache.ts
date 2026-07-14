import type { CacheStoresConfigT } from 'metro-config';
import { CacheStore, MetroCache } from 'metro-cache';
import type { MixedOutput, TransformResult } from 'metro';

// Directory creation is handled by the cache package's
// ensureDomainDirectories; FileStore also self-heals a missing root by
// re-creating directories on ENOENT during writes.
export const getHarnessCacheStores = (
  cacheRoot: string
): ((metroCache: MetroCache) => CacheStoresConfigT) => {
  return ({ FileStore }) => [
    new FileStore({ root: cacheRoot }) as CacheStore<
      TransformResult<MixedOutput>
    >,
  ];
};
