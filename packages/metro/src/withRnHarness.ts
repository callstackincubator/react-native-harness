import type { MetroConfig } from 'metro-config';
import { getConfig } from '@react-native-harness/config';
import { getHarnessResolver } from './resolver';
import { getHarnessManifest } from './manifest';
import { getHarnessBabelTransformerPath } from './babel-transformer';
import { getHarnessCacheStores } from './metro-cache';
import type { NotReadOnly } from './utils';

const INTERNAL_CALLSITES_REGEX =
  /(^|[\\/])(node_modules[/\\]@react-native-harness)([\\/]|$)/;

export const withRnHarness = <T extends MetroConfig>(
  config: T | Promise<T>,
  isInvokedByHarness = false
): (() => Promise<T>) => {
  // This is a workaround for a regression in Metro 0.83, when promises are not handled correctly.
  return async () => {
    // If the function is not invoked by the Harness, return the config as is.
    // We'll remove it in the next major version.
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
      serializer: {
        ...metroConfig.serializer,
        getPolyfills: (...args) => [
          ...(metroConfig.serializer?.getPolyfills?.(...args) ?? []),
          harnessManifest,
          require.resolve(
            '@react-native-harness/runtime/polyfills/harness-module-system'
          ),
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
        // Unlock __tests__ directory
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
      ).customSerializer =
        require('./getHarnessSerializer').getHarnessSerializer();
    }

    return patchedConfig as T;
  };
};
