import { MetroConfig } from '@react-native/metro-config';
import { patchModuleSystem } from './moduleSystem';

// These modules are already present in the main bundle
const TEST_MODULES_IMPORTS_BLACKLIST = [
  'react-native',
  'react-native-harness',
];

export const withRnHarness = (
  config: MetroConfig,
  options = { enabled: !!process.env.RN_HARNESS }
): MetroConfig => {
  if (!options.enabled) {
    return config;
  }

  patchModuleSystem();

  const resolveRequest = config.resolver?.resolveRequest

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
      resolveRequest: (context, moduleName, platform) => {
        // Use custom resolver if provided or fallback to the default one
        const resolve = resolveRequest ?? context.resolveRequest;

        const resolverOptions = context.customResolverOptions;
        const isHarness = resolverOptions?.isHarness === 'true';

        // Do not resolve these modules when bundling tests
        if (isHarness && TEST_MODULES_IMPORTS_BLACKLIST.includes(moduleName)) {
          return {
            type: 'empty'
          }
        }

        return resolve(context, moduleName, platform);
      },
      // Unlock __tests__ directory
      blockList: undefined,
    },
  };
};
