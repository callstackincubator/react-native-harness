import { CouldNotPatchModuleSystemError } from './errors';

const optionalResolve = (path: string, from: string): string | null => {
  try {
    return require.resolve(path, { paths: [from] });
  } catch {
    return null;
  }
};

const getMetroDefaultsPath = (): string => {
  const reactNativeMetroConfigPath = require.resolve(
    '@react-native/metro-config',
    { paths: [process.cwd()] }
  );

  const preExportsDefaults = optionalResolve(
    'metro-config/src/defaults/defaults',
    reactNativeMetroConfigPath
  );

  if (preExportsDefaults) {
    return preExportsDefaults;
  }

  const privateDefaults = optionalResolve(
    'metro-config/private/defaults/defaults',
    reactNativeMetroConfigPath
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
