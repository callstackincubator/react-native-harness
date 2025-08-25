import { mergeConfig, MetroConfig } from '@react-native/metro-config';

export const withRnHarness = (
  config: MetroConfig,
  options = { enabled: !!process.env.RN_HARNESS }
): MetroConfig => {
  if (!options.enabled) {
    return config;
  }

  const reactNativeMetroConfigPath = require.resolve(
    '@react-native/metro-config',
    { paths: [process.cwd()] }
  );

  require('metro-config/src/defaults/defaults').moduleSystem = require.resolve(
    '@react-native-harness/runtime/moduleSystem',
    { paths: [reactNativeMetroConfigPath] }
  );

  return mergeConfig(config, {
    cacheVersion: 'react-native-harness',
    serializer: {
      getPolyfills: (...args) => [
        ...(config.serializer?.getPolyfills?.(...args) ?? []),
        require.resolve('../assets/init.js'),
      ],
    },
  });
};
