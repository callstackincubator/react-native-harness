import { CouldNotPatchModuleSystemError } from './errors';

const optionalResolve = (path: string, from: string): string | null => {
  try {
    return require.resolve(path, { paths: [from] });
  } catch {
    return null;
  }
};

const getMetroConfigPath = (): string => {
  const expoConfigPath = optionalResolve('@expo/metro-config', process.cwd());

  if (expoConfigPath) {
    return expoConfigPath;
  }

  const reactNativeMetroConfigPath = optionalResolve(
    '@react-native/metro-config',
    process.cwd()
  );

  if (reactNativeMetroConfigPath) {
    return reactNativeMetroConfigPath;
  }

  throw new CouldNotPatchModuleSystemError();
};

const getMetroDefaultsPath = (): string => {
  const metroConfigPath = getMetroConfigPath();

  const preExportsDefaults = optionalResolve(
    'metro-config/src/defaults/defaults',
    metroConfigPath
  );

  if (preExportsDefaults) {
    return preExportsDefaults;
  }

  const privateDefaults = optionalResolve(
    'metro-config/private/defaults/defaults',
    metroConfigPath
  );

  if (privateDefaults) {
    return privateDefaults;
  }

  throw new CouldNotPatchModuleSystemError();
};

export const patchModuleSystem = (): void => {
  const metroConfigPath = getMetroDefaultsPath();
  const metroConfig = require(metroConfigPath);

  metroConfig.moduleSystem = require.resolve(
    '@react-native-harness/runtime/moduleSystem'
  );
};
