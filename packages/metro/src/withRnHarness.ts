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

  const metroConfigPath = require.resolve(
    'metro-config/src/defaults/defaults',
    { paths: [reactNativeMetroConfigPath] }
  );

  const metroConfig = require(metroConfigPath);

  metroConfig.moduleSystem = require.resolve(
    '@react-native-harness/runtime/moduleSystem',
    { paths: [process.cwd()] }
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
