import type { MetroConfig } from '@react-native/metro-config';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { createHarnessResolver } from './composite-resolver';
import { createTsConfigResolver } from './tsconfig-resolver';
import type { HarnessResolver, MetroResolver } from './types';

export const createHarnessEntryPointResolver = (
  harnessConfig: HarnessConfig
): HarnessResolver => {
  // Can be relative to the project root or absolute, need to normalize it
  const resolvedEntryPointPath = require.resolve(harnessConfig.entryPoint, {
    paths: [process.cwd()],
  });

  return (_context, moduleName, _platform) => {
    if (moduleName === resolvedEntryPointPath) {
      return {
        type: 'sourceFile',
        filePath: require.resolve('@react-native-harness/runtime/entry-point'),
      };
    }

    if (moduleName === harnessConfig.entryPoint) {
      return {
        type: 'sourceFile',
        filePath: require.resolve('@react-native-harness/runtime/entry-point'),
      };
    }

    if (typeof moduleName === 'string') {
      try {
        const resolvedModuleName = require.resolve(moduleName, {
          paths: [process.cwd()],
        });
        if (resolvedModuleName === resolvedEntryPointPath) {
          return {
            type: 'sourceFile',
            filePath: require.resolve(
              '@react-native-harness/runtime/entry-point'
            ),
          };
        }
      } catch {
        // Ignore and fall through
      }
    }

    return null;
  };
};

export const createJestGlobalsResolver = (): HarnessResolver => {
  return (_context, moduleName, _platform) => {
    // Intercept @jest/globals imports and redirect to mock module
    if (moduleName === '@jest/globals') {
      return {
        type: 'sourceFile',
        filePath: require.resolve('../jest-globals-mock'),
      };
    }

    return null;
  };
};

export const createJsxRuntimeResolver = (): HarnessResolver => {
  const resolvedJsxRuntimePath = require.resolve(
    '@react-native-harness/runtime/jsx-runtime'
  );
  const resolvedJsxDevRuntimePath = require.resolve(
    '@react-native-harness/runtime/jsx-dev-runtime'
  );

  return (_context, moduleName, _platform) => {
    if (moduleName === '@react-native-harness/runtime/jsx-runtime') {
      return {
        type: 'sourceFile',
        filePath: resolvedJsxRuntimePath,
      };
    }

    if (moduleName === '@react-native-harness/runtime/jsx-dev-runtime') {
      return {
        type: 'sourceFile',
        filePath: resolvedJsxDevRuntimePath,
      };
    }

    return null;
  };
};

export const getHarnessResolver = (
  metroConfig: MetroConfig,
  harnessConfig: HarnessConfig
): MetroResolver => {
  const userResolver = metroConfig.resolver?.resolveRequest;
  const resolvers: HarnessResolver[] = [
    createHarnessEntryPointResolver(harnessConfig),
    createJestGlobalsResolver(),
    createJsxRuntimeResolver(),
    createTsConfigResolver(process.cwd()),
    userResolver,
  ].filter((resolver): resolver is HarnessResolver => !!resolver);

  return createHarnessResolver(resolvers);
};
