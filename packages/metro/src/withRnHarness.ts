import { mergeConfig, MetroConfig } from '@react-native/metro-config';

export const withRnHarness = (
  config: MetroConfig,
  options = { enabled: !!process.env.RN_HARNESS }
): MetroConfig => {
  if (!options.enabled) {
    return config;
  }

  return mergeConfig(config, {
    serializer: {
      getPolyfills: (polyfillOptions) => {
        return [
          ...(config.serializer?.getPolyfills?.(polyfillOptions) ?? []),
          // require.resolve('./init.js'),
        ];
      },
    },
  });
};
