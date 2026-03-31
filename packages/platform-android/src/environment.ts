import os from 'node:os';
import path from 'node:path';

const CMDLINE_TOOLS_PATH_SEGMENTS = ['cmdline-tools', 'latest'];

export const getAndroidSdkRoot = (
  env: NodeJS.ProcessEnv = process.env
): string | null => {
  return env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? null;
};

const getRequiredAndroidSdkRoot = (): string => {
  const sdkRoot = getAndroidSdkRoot();

  if (!sdkRoot) {
    throw new Error(
      'Android SDK root is not configured. Set ANDROID_HOME or ANDROID_SDK_ROOT.'
    );
  }

  return sdkRoot;
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

export const initializeAndroidProcessEnv = (): void => {
  Object.assign(process.env, getAndroidProcessEnv());
};

export const getAdbBinaryPath = (): string =>
  path.join(getRequiredAndroidSdkRoot(), 'platform-tools', 'adb');

export const getEmulatorBinaryPath = (): string =>
  path.join(getRequiredAndroidSdkRoot(), 'emulator', 'emulator');

export const getSdkManagerBinaryPath = (): string =>
  path.join(
    getRequiredAndroidSdkRoot(),
    ...CMDLINE_TOOLS_PATH_SEGMENTS,
    'bin',
    'sdkmanager'
  );

export const getAvdManagerBinaryPath = (): string =>
  path.join(
    getRequiredAndroidSdkRoot(),
    ...CMDLINE_TOOLS_PATH_SEGMENTS,
    'bin',
    'avdmanager'
  );
