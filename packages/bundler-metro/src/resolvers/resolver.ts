import { createRequire } from 'node:module';
import path from 'node:path';
import type { MetroConfig } from '@react-native/metro-config';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { getResolvedEntryPointWithoutExtension } from '../entry-point-utils.js';
import { createHarnessResolver } from './composite-resolver.js';
import { createTsConfigResolver } from './tsconfig-resolver.js';
import type { HarnessResolver, MetroResolver } from './types.js';

const require = createRequire(import.meta.url);

const getExtensionlessAbsolutePath = (
  basePath: string,
  relativePath = '',
): string => {
  const fullPath = path.resolve(basePath, relativePath);
  const parsed = path.parse(fullPath);
  return path.join(parsed.dir, parsed.name);
};

export const createHarnessEntryPointResolver = (
  harnessConfig: HarnessConfig,
): HarnessResolver => {
  const rootPath = path.resolve(process.cwd());
  const expectedEntryPoint = path.resolve(
    rootPath,
    getResolvedEntryPointWithoutExtension(rootPath, harnessConfig.entryPoint),
  );
  const resolvedHarnessPath =
    require.resolve('@react-native-harness/runtime/entry-point');

  return (context, moduleName, platform) => {
    void platform;
    const currentOrigin = path.resolve(context.originModulePath);

    // Entry requests originate from the project root, or - in monorepos where
    // Metro's server root is above the project (e.g. Expo) - from that
    // ancestor directory.
    if (
      currentOrigin !== rootPath &&
      !rootPath.startsWith(currentOrigin + path.sep)
    ) {
      return null;
    }

    const requestedModule = getExtensionlessAbsolutePath(
      currentOrigin,
      moduleName,
    );

    // Expo apps may request the virtual entry `.expo/.virtual-metro-entry`
    // (the bundle root baked into the generated native project), which Expo's
    // resolver maps to the app's real entry point. It never matches the
    // configured entryPoint textually, so treat it as the app entry too.
    const isExpoVirtualEntry = /[/\\]\.expo[/\\]\.virtual-metro-entry$/.test(
      requestedModule,
    );

    if (requestedModule === expectedEntryPoint || isExpoVirtualEntry) {
      return {
        type: 'sourceFile',
        filePath: resolvedHarnessPath,
      };
    }

    return null;
  };
};

export const createJestGlobalsResolver = (): HarnessResolver => {
  return (_context, moduleName, platform) => {
    void platform;
    if (moduleName === '@jest/globals') {
      return {
        type: 'sourceFile',
        filePath: require.resolve('../jest-globals-mock.js'),
      };
    }

    return null;
  };
};

export const createJsxRuntimeResolver = (): HarnessResolver => {
  const resolvedJsxRuntimePath =
    require.resolve('@react-native-harness/runtime/jsx-runtime');
  const resolvedJsxDevRuntimePath =
    require.resolve('@react-native-harness/runtime/jsx-dev-runtime');

  return (_context, moduleName, platform) => {
    void platform;
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
  harnessConfig: HarnessConfig,
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
