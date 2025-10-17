import { MetroConfig } from '@react-native/metro-config';
import { getConfig } from '@react-native-harness/config';
import { patchModuleSystem } from './moduleSystem';
import { getHarnessResolver } from './resolver';
import { getHarnessManifest } from './manifest';
import { getHarnessBabelTransformerPath } from './babel-transformer';

export const withRnHarness = async (
  config: MetroConfig | Promise<MetroConfig>
): Promise<MetroConfig> => {
  const isEnabled = !!process.env.RN_HARNESS;

  if (!isEnabled) {
    return config;
  }

  const metroConfig = await config;
  const { config: harnessConfig } = await getConfig(process.cwd());

  patchModuleSystem();

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
      ],
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
  };

  if (harnessConfig.unstable__skipAlreadyIncludedModules) {
    patchedConfig.serializer!.customSerializer =
      require('./getHarnessSerializer').getHarnessSerializer();
  }

  return patchedConfig;
};
