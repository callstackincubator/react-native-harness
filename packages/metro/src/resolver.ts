import type { MetroConfig } from '@react-native/metro-config';
import type { Config as HarnessConfig } from '@react-native-harness/config';

type CustomResolver = NonNullable<
  NonNullable<MetroConfig['resolver']>['resolveRequest']
>;

export const getHarnessResolver = (
  metroConfig: MetroConfig,
  harnessConfig: HarnessConfig
): CustomResolver => {
  // Can be relative to the project root or absolute, need to normalize it
  const resolvedEntryPointPath = require.resolve(harnessConfig.entryPoint, {
    paths: [process.cwd()],
  });

  return (context, moduleName, platform) => {
    const existingResolver =
      metroConfig.resolver?.resolveRequest ?? context.resolveRequest;
    const resolvedModule = existingResolver(context, moduleName, platform);

    // Replace the entry point with Harness
    if (
      resolvedModule.type === 'sourceFile' &&
      resolvedModule.filePath === resolvedEntryPointPath
    ) {
      return {
        type: 'sourceFile',
        filePath: require.resolve('@react-native-harness/runtime/entry-point'),
      };
    }

    return resolvedModule;
  };
};
