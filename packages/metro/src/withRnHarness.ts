import { MetroConfig } from '@react-native/metro-config';
import { patchModuleSystem } from './moduleSystem';

export type RnHarnessOptions = {
  unstable__skipAlreadyIncludedModules?: boolean;
};

export const withRnHarness = (
  config: MetroConfig,
  options: RnHarnessOptions = {}
): MetroConfig => {
  const isEnabled = !!process.env.RN_HARNESS;

  if (!isEnabled) {
    return config;
  }

  patchModuleSystem();

  const patchedConfig: MetroConfig = {
    ...config,
    cacheVersion: 'react-native-harness',
    serializer: {
      ...config.serializer,
      getPolyfills: (...args) => [
        ...(config.serializer?.getPolyfills?.(...args) ?? []),
        require.resolve('../assets/init.js'),
      ],
    },
    resolver: {
      ...config.resolver,
      // Unlock __tests__ directory
      blockList: undefined,
    },
  };

  if (options.unstable__skipAlreadyIncludedModules) {
    patchedConfig.serializer!.customSerializer =
      require('./getHarnessSerializer').getHarnessSerializer();
  }

  return patchedConfig;
};
