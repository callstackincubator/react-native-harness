import os from 'node:os';
import path from 'node:path';
import type { SpawnOptions } from '@react-native-harness/tools';

const CMDLINE_TOOLS_PATH_SEGMENTS = ['cmdline-tools', 'latest'];

const getAndroidSdkRoot = (env: NodeJS.ProcessEnv): string | null => {
  return env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? null;
};

export const getAndroidProcessEnv = (
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv => {
  const sdkRoot = getAndroidSdkRoot(env);

  if (!sdkRoot) {
    return env;
  }

  const platformToolsPath = path.join(sdkRoot, 'platform-tools');
  const emulatorPath = path.join(sdkRoot, 'emulator');
  const cmdlineToolsPath = path.join(sdkRoot, ...CMDLINE_TOOLS_PATH_SEGMENTS);
  const cmdlineToolsBinPath = path.join(cmdlineToolsPath, 'bin');
  const currentPath = env.PATH ?? '';
  const pathEntries = [
    platformToolsPath,
    emulatorPath,
    cmdlineToolsPath,
    cmdlineToolsBinPath,
    currentPath,
  ].filter((entry) => entry !== '');

  return {
    ...env,
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_AVD_HOME: path.join(os.homedir(), '.android', 'avd'),
    PATH: pathEntries.join(path.delimiter),
  };
};

export const withAndroidProcessEnv = (
  options?: SpawnOptions
): SpawnOptions => ({
  ...options,
  env: getAndroidProcessEnv(options?.env),
});
