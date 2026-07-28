import { createRequire } from 'node:module';
import os from 'node:os';
import type { MetroConfig } from 'metro-config';
import { createHarnessCache } from '@react-native-harness/cache';
import {
  getConfig,
  resolveMetroCacheEnabled,
  resolveSkipAlreadyIncludedModules,
  type Config,
} from '@react-native-harness/config';
import { logger } from '@react-native-harness/tools';
import { getHarnessBabelTransformerPath } from './babel-transformer.js';
import { getHarnessSerializer } from './getHarnessSerializer.js';
import { getHarnessManifest } from './manifest.js';
import {
  HARNESS_METRO_BLOCK_LIST_PATTERNS,
  mergeHarnessBlockList,
} from './metro-block-list.js';
import { getHarnessCacheStores } from './metro-cache.js';
import { getCappedMaxWorkers } from './metro-workers.js';
import { getHarnessResolver } from './resolvers/resolver.js';
import type { NotReadOnly } from './utils.js';

const require = createRequire(import.meta.url);
const metroWorkersLogger = logger.child('metro-workers');

const INTERNAL_CALLSITES_REGEX =
  /(^|[\\/])(node_modules[/\\]@react-native-harness)([\\/]|$)/;

const getHarnessCacheVersion = (harnessConfig: Config): string => {
  const { version } = require('../package.json') as { version: string };
  const userSalt = harnessConfig.cache?.version;

  return userSalt
    ? `react-native-harness:${version}:${userSalt}`
    : `react-native-harness:${version}`;
};

export const withRnHarness = <T extends MetroConfig>(
  config: T | Promise<T>,
  isInvokedByHarness = false,
): (() => Promise<T>) => {
  return async () => {
    if (!isInvokedByHarness) {
      return config;
    }

    const metroConfig = await config;
    const { config: harnessConfig, projectRoot } = await getConfig(
      process.cwd()
    );
    const harnessCache = createHarnessCache({ projectRoot });

    const harnessResolver = getHarnessResolver(metroConfig, harnessConfig);
    const harnessManifest = getHarnessManifest(harnessConfig);
    const harnessBabelTransformerPath =
      getHarnessBabelTransformerPath(metroConfig);

    const hostParallelism = os.availableParallelism();
    const cappedMaxWorkers = getCappedMaxWorkers({
      configuredMaxWorkers: metroConfig.maxWorkers,
      hostParallelism,
    });

    if (cappedMaxWorkers !== metroConfig.maxWorkers) {
      metroWorkersLogger.debug(
        'Capping Metro maxWorkers from %s to %s (host parallelism: %s)',
        metroConfig.maxWorkers ?? 'default',
        cappedMaxWorkers,
        hostParallelism
      );
    }

    // In CI, disable the watchman crawler outright: `runServer`'s own
    // `watch: false` (see factory.ts) only disables file *watching*, but
    // metro-file-map still prefers watchman for the initial crawl, which
    // starts a daemon that indexes the whole monorepo in memory. Locally,
    // watchman is genuinely useful (incremental rebuilds), so leave the
    // existing debug override untouched there.
    const isCI = Boolean(process.env.CI);
    const useWatchman = isCI
      ? false
      : process.env.RN_HARNESS_DEBUG_USE_WATCHMAN !== '0';

    if (isCI) {
      metroWorkersLogger.debug(
        'Disabling Metro/watchman crawler because CI is set'
      );
    }

    const mergedBlockList = mergeHarnessBlockList(
      metroConfig.resolver?.blockList
    );

    metroWorkersLogger.debug(
      'Extending Metro resolver.blockList with %s harness build-output pattern(s) (%s total)',
      HARNESS_METRO_BLOCK_LIST_PATTERNS.length,
      mergedBlockList.length
    );

    const patchedConfig: MetroConfig = {
      ...metroConfig,
      cacheVersion: getHarnessCacheVersion(harnessConfig),
      maxWorkers: cappedMaxWorkers,
      server: {
        ...metroConfig.server,
        forwardClientLogs: harnessConfig.forwardClientLogs ?? false,
      },
      serializer: {
        ...metroConfig.serializer,
        getPolyfills: (...args) => [
          ...(metroConfig.serializer?.getPolyfills?.(...args) ?? []),
          harnessManifest,
          require.resolve('@react-native-harness/runtime/polyfills/harness-module-system'),
        ],
        isThirdPartyModule({ path: modulePath }) {
          const isThirdPartyByDefault =
            metroConfig.serializer?.isThirdPartyModule?.({
              path: modulePath,
            }) ?? false;

          if (isThirdPartyByDefault) {
            return true;
          }

          return INTERNAL_CALLSITES_REGEX.test(modulePath);
        },
      },
      resolver: {
        ...metroConfig.resolver,
        blockList: mergedBlockList,
        resolveRequest: harnessResolver,
        useWatchman,
      },
      transformer: {
        ...metroConfig.transformer,
        babelTransformerPath: harnessBabelTransformerPath,
      },
      symbolicator: {
        ...metroConfig.symbolicator,
        customizeFrame: async (frame) => {
          const defaultCustomizeFrame =
            await metroConfig.symbolicator?.customizeFrame?.(frame);
          const shouldCollapseByDefault =
            defaultCustomizeFrame?.collapse ?? false;

          if (shouldCollapseByDefault) {
            return {
              collapse: true,
            };
          }

          return {
            collapse:
              frame.file != null && INTERNAL_CALLSITES_REGEX.test(frame.file),
          };
        },
      },
    };

    if (resolveMetroCacheEnabled(harnessConfig)) {
      harnessCache.ensureDomainDirectories('metro');

      (patchedConfig.cacheStores as NotReadOnly<MetroConfig['cacheStores']>) =
        getHarnessCacheStores(harnessCache.paths.metroTransform);

      // Without an explicit directory the file-map cache lands in $TMPDIR;
      // pin it under the harness cache root unless the user already picked a
      // location.
      if (
        metroConfig.fileMapCacheDirectory === undefined &&
        metroConfig.hasteMapCacheDirectory === undefined
      ) {
        (
          patchedConfig as NotReadOnly<
            Pick<MetroConfig, 'fileMapCacheDirectory'>
          >
        ).fileMapCacheDirectory = harnessCache.paths.metroFileMap;
      }
    }

    if (resolveSkipAlreadyIncludedModules(harnessConfig)) {
      (
        patchedConfig.serializer as NonNullable<
          NotReadOnly<MetroConfig['serializer']>
        >
      ).customSerializer = getHarnessSerializer({
        harnessEntryPointPath: require.resolve(
          '@react-native-harness/runtime/entry-point'
        ),
        customSerializer: metroConfig.serializer?.customSerializer ?? undefined,
      });
    }

    return patchedConfig as T;
  };
};
