import { MetroConfig } from '@react-native/metro-config';
import { getConfig } from '@react-native-harness/config';
import { patchModuleSystem } from './moduleSystem';

export type RnHarnessOptions = {
  unstable__skipAlreadyIncludedModules?: boolean;
};

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

  const patchedConfig: MetroConfig = {
    ...metroConfig,
    cacheVersion: 'react-native-harness',
    serializer: {
      ...metroConfig.serializer,
      getPolyfills: (...args) => [
        ...(metroConfig.serializer?.getPolyfills?.(...args) ?? []),
        require.resolve('../assets/init.js'),
      ],
    },
    resolver: {
      ...metroConfig.resolver,
      // Unlock __tests__ directory
      blockList: undefined,
    },
  };

  if (harnessConfig.unstable__skipAlreadyIncludedModules) {
    patchedConfig.serializer!.customSerializer =
      require('./getHarnessSerializer').getHarnessSerializer();
  }

  return patchedConfig;
};
