import { MetroConfig } from '@react-native/metro-config';
import { patchModuleSystem } from './moduleSystem';

export const withRnHarness = (
  config: MetroConfig,
  options = { enabled: !!process.env.RN_HARNESS }
): MetroConfig => {
  if (!options.enabled) {
    return config;
  }

  patchModuleSystem();

  return {
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
};
