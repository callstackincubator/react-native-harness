import type { MetroConfig } from '@react-native/metro-config';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import path from 'node:path';
import { createHarnessResolver } from './composite-resolver';
import { createTsConfigResolver } from './tsconfig-resolver';
import type { HarnessResolver, MetroResolver } from './types';

// Safely resolves a path and strips its extension
const getExtensionlessAbsolutePath = (basePath: string, relativePath = ''): string => {
  const fullPath = path.resolve(basePath, relativePath);
  const parsed = path.parse(fullPath);
  return path.join(parsed.dir, parsed.name);
}

export const createHarnessEntryPointResolver = (harnessConfig: HarnessConfig): HarnessResolver => {
  const rootPath = path.resolve(process.cwd());
  const expectedEntryPoint = getExtensionlessAbsolutePath(rootPath, harnessConfig.entryPoint);
  const resolvedHarnessPath = require.resolve('@react-native-harness/runtime/entry-point');

  return (context, moduleName, _platform) => {
    // 1. Resolve the origin path of the file making the import
    const currentOrigin = path.resolve(context.originModulePath);

    // Fast Fail: If the import isn't happening from the root directory, skip it immediately
    if (currentOrigin !== rootPath) {
      return null;
    }

    // 2. Resolve the module being imported and strip its extension
    // This safely normalizes './index', './index.js', 'index.js', etc.
    const requestedModule = getExtensionlessAbsolutePath(currentOrigin, moduleName);

    // 3. String comparison
    if (requestedModule === expectedEntryPoint) {
      return {
        type: 'sourceFile',
        filePath: resolvedHarnessPath,
      };
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
