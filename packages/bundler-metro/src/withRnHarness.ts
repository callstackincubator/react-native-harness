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
import { getHarnessBlockList } from './metro-block-list.js';
import { getHarnessCacheStores } from './metro-cache.js';
import { getCappedMaxWorkers } from './metro-workers.js';
import { getHarnessResolver } from './resolvers/resolver.js';
import type { MetroConfigEnhancer } from './types.js';
import type { NotReadOnly } from './utils.js';

const require = createRequire(import.meta.url);
const metroWorkersLogger = logger.child('metro-workers');
const metroBlockListLogger = logger.child('metro-block-list');

const INTERNAL_CALLSITES_REGEX =
  /(^|[\\/])(node_modules[/\\]@react-native-harness)([\\/]|$)/;

const getHarnessCacheVersion = (harnessConfig: Config): string => {
  const { version } = require('../package.json') as { version: string };
  const userSalt = harnessConfig.cache?.version;

  return userSalt
    ? `react-native-harness:${version}:${userSalt}`
    : `react-native-harness:${version}`;
};

/**
 * The selected runner's `metroConfigEnhancer`, resolved to a module specifier,
 * plus the runner context the bundler forwards to it.
 */
export type MetroConfigEnhancerRef = {
  module: string;
  platformId: string;
  platformConfig: unknown;
};

export const withRnHarness = <T extends MetroConfig>(
  config: T | Promise<T>,
  isInvokedByHarness = false,
  enhancer?: MetroConfigEnhancerRef,
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

    const { blockList: harnessBlockList, dropped: droppedBlockListPatterns } =
      getHarnessBlockList(metroConfig, harnessCache.paths.root);

    for (const { pattern } of droppedBlockListPatterns) {
      metroBlockListLogger.warn(
        'Ignoring `resolver.blockList` pattern %s because its regex flags conflict with the other blockList patterns.',
        String(pattern)
      );
    }

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

    const patchedConfig: MetroConfig = {
      ...metroConfig,
      cacheVersion: getHarnessCacheVersion(harnessConfig),
      maxWorkers: cappedMaxWorkers,
      server: {
        ...metroConfig.server,
        forwardClientLogs: harnessConfig.forwardClientLogs ?? false,
        // Metro's global hotkey puts stdin into raw mode to listen for a
        // dev-server reload key. A harness run is non-interactive and Jest
        // owns stdin in watch mode, so it is pure overhead here.
        useGlobalHotkey: false,
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
        blockList: harnessBlockList,
        resolveRequest: harnessResolver,
        useWatchman: process.env.RN_HARNESS_DEBUG_USE_WATCHMAN !== '0',
      },
      transformer: {
        ...metroConfig.transformer,
        babelTransformerPath: harnessBabelTransformerPath,
        // Run transform workers as threads rather than child processes. Each
        // child process carries its own Node runtime and Babel instance;
        // threads share them, which roughly halves peak RSS for a cold
        // bundle at no cost to build time.
        unstable_workerThreads:
          process.env.RN_HARNESS_DEBUG_WORKER_THREADS !== '0',
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

    if (enhancer) {
      return (await runMetroConfigEnhancer(
        enhancer,
        patchedConfig,
        projectRoot
      )) as T;
    }

    return patchedConfig as T;
  };
};

/**
 * Imports the module the selected runner's `metroConfigEnhancer` points at and
 * runs its default export against the config Harness has composed.
 *
 * A platform whose runtime needs its own bundler wiring — module resolution
 * redirects, additional `resolver.platforms` entries, its own core
 * initialization — declares it here rather than in this package, so nothing in
 * the bundler has to know which platforms exist. It runs last, on the fully
 * composed config, and whatever it returns is what Metro is started with.
 */
const runMetroConfigEnhancer = async <T extends MetroConfig>(
  enhancer: MetroConfigEnhancerRef,
  metroConfig: T,
  projectRoot: string
): Promise<T> => {
  const enhancerModule = (await import(enhancer.module)) as {
    default?: MetroConfigEnhancer;
  };
  const enhance = enhancerModule.default;

  if (typeof enhance !== 'function') {
    throw new Error(
      `metroConfigEnhancer module "${enhancer.module}" has no default export function`
    );
  }

  return (await enhance(metroConfig, {
    projectRoot,
    platformId: enhancer.platformId,
    platformConfig: enhancer.platformConfig,
  })) as T;
};
