import { createRequire } from 'node:module';
import type { MetroConfig } from 'metro-config';
import { getConfig } from '@react-native-harness/config';
import { getHarnessBabelTransformerPath } from './babel-transformer.js';
import { getHarnessSerializer } from './getHarnessSerializer.js';
import { getHarnessManifest } from './manifest.js';
import { getHarnessCacheStores } from './metro-cache.js';
import { getHarnessResolver } from './resolvers/resolver.js';
import type { NotReadOnly } from './utils.js';

const require = createRequire(import.meta.url);

const INTERNAL_CALLSITES_REGEX =
  /(^|[\\/])(node_modules[/\\]@react-native-harness)([\\/]|$)/;

export const withRnHarness = <T extends MetroConfig>(
  config: T | Promise<T>,
  isInvokedByHarness = false,
): (() => Promise<T>) => {
  return async () => {
    if (!isInvokedByHarness) {
      return config;
    }

    const metroConfig = await config;
    const { config: harnessConfig } = await getConfig(process.cwd());

    const harnessResolver = getHarnessResolver(metroConfig, harnessConfig);
    const harnessManifest = getHarnessManifest(harnessConfig);
    const harnessBabelTransformerPath =
      getHarnessBabelTransformerPath(metroConfig);

    const patchedConfig: MetroConfig = {
      ...metroConfig,
      cacheVersion: 'react-native-harness',
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
        blockList: undefined,
        resolveRequest: harnessResolver,
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

    if (harnessConfig.unstable__enableMetroCache) {
      (patchedConfig.cacheStores as NotReadOnly<MetroConfig['cacheStores']>) =
        getHarnessCacheStores();
    }

    if (harnessConfig.unstable__skipAlreadyIncludedModules) {
      (
        patchedConfig.serializer as NonNullable<
          NotReadOnly<MetroConfig['serializer']>
        >
      ).customSerializer = getHarnessSerializer();
    }

    return patchedConfig as T;
  };
};
