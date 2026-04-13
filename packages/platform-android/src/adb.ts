import { type AndroidAppLaunchOptions } from '@react-native-harness/platforms';
import { spawn, SubprocessError } from '@react-native-harness/tools';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import {
  getAvdConfigPath,
  getAvdDirectory,
  readAvdConfig,
} from './avd-config.js';
import {
  ensureAndroidEmulatorAvailable,
  ensureAndroidSdkPackages,
  getAdbBinaryPath,
  getAndroidSystemImagePackage,
  getAvdManagerBinaryPath,
  getEmulatorBinaryPath,
  getHostAndroidSystemImageArch,
  getRequiredAndroidSdkPackages,
} from './environment.js';
import {
  getEmulatorStartupArgs,
  type EmulatorBootMode,
} from './emulator-startup.js';

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const waitForAbort = (signal: AbortSignal): Promise<never> => {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason);
      },
      { once: true },
    );
  });
};

const waitWithSignal = async (
  ms: number,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) {
    throw signal.reason;
  }

  await Promise.race([wait(ms), waitForAbort(signal)]);
};

const EMULATOR_STARTUP_OBSERVATION_TIMEOUT_MS = 5000;
const EMULATOR_OUTPUT_BUFFER_LIMIT = 16 * 1024;

export const emulatorProcess = {
  startDetachedProcess: (
    file: string,
    args: readonly string[],
  ): ChildProcessByStdio<null, Readable, Readable> =>
    nodeSpawn(file, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
};

const appendBoundedOutput = (
  output: string,
  chunk: string,
  limit: number = EMULATOR_OUTPUT_BUFFER_LIMIT,
): string => {
  const nextOutput = output + chunk;

  if (nextOutput.length <= limit) {
    return nextOutput;
  }

  return nextOutput.slice(-limit);
};

const formatEmulatorStartupError = ({
  name,
  stdout,
  stderr,
  exitCode,
  signal,
  error,
}: {
  name: string;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  error?: unknown;
}): Error => {
  const sections = [`Failed to start Android emulator @${name}.`];

  if (typeof exitCode === 'number') {
    sections.push(`Exit code: ${exitCode}`);
  }

  if (signal) {
    sections.push(`Signal: ${signal}`);
  }

  if (error instanceof Error) {
    sections.push(`Cause: ${error.message}`);
  }

  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();

  if (trimmedStdout !== '') {
    sections.push(`stdout:\n${trimmedStdout}`);
  }

  if (trimmedStderr !== '') {
    sections.push(`stderr:\n${trimmedStderr}`);
  }

  return new Error(sections.join('\n\n'), {
    cause: error instanceof Error ? error : undefined,
  });
};

const ensureEmulatorInstalled = async (): Promise<string> => {
  await ensureAndroidEmulatorAvailable();

  const emulatorBinaryPath = getEmulatorBinaryPath();
  await access(emulatorBinaryPath);
  return emulatorBinaryPath;
};

export type CreateAvdOptions = {
  name: string;
  apiLevel: number;
  profile: string;
  diskSize: string;
  heapSize: string;
};

export const getRequiredEmulatorPackages = (apiLevel: number): string[] => {
  return getRequiredAndroidSdkPackages({
    apiLevel,
    includeEmulator: true,
    architecture: getHostAndroidSystemImageArch(),
  });
};

export const verifyAndroidEmulatorSdk = async (
  apiLevel: number,
): Promise<void> => {
  await ensureAndroidSdkPackages(getRequiredEmulatorPackages(apiLevel));
};

const listAvdProfiles = async (): Promise<string[]> => {
  const { stdout } = await spawn(getAvdManagerBinaryPath(), ['list', 'device']);

  return stdout
    .split('\n')
    .map((line) => line.match(/^id:\s+\d+\s+or\s+"([^"]+)"/i)?.[1]?.trim())
    .filter((profile): profile is string => profile != null && profile !== '');
};

const ensureAvdProfileAvailable = async (profile: string): Promise<void> => {
  const availableProfiles = await listAvdProfiles();

  if (availableProfiles.includes(profile)) {
    return;
  }

  const availableProfilesList =
    availableProfiles.length > 0
      ? availableProfiles.join(', ')
      : 'None reported by avdmanager.';

  throw new Error(
    `Android AVD profile "${profile}" is not available on this machine. Available profiles: ${availableProfilesList}`,
  );
};

const ensureAvdConfigExists = async (name: string): Promise<string> => {
  const configPath = getAvdConfigPath(name);

  if ((await readAvdConfig(name)) == null) {
    throw new Error(
      `Android AVD "${name}" was created, but config.ini was not found at ${configPath}.`,
    );
  }

  return configPath;
};

const getAvdIniPath = (name: string): string => {
  const avdHome =
    process.env.ANDROID_AVD_HOME ?? `${process.env.HOME}/.android/avd`;
  return `${avdHome}/${name}.ini`;
};

const ensureAvdIniExists = async ({
  name,
  apiLevel,
}: {
  name: string;
  apiLevel: number;
}): Promise<string> => {
  const iniPath = getAvdIniPath(name);

  const avdDirectory = getAvdDirectory(name);
  await spawn('bash', [
    '-lc',
    `printf '%s\n%s\n%s\n%s\n' 'avd.ini.encoding=UTF-8' 'path=${avdDirectory}' 'path.rel=avd/${name}.avd' 'target=android-${apiLevel}' > "${iniPath}"`,
  ]);

  return iniPath;
};

export const getStartAppArgs = (
  bundleId: string,
  activityName: string,
  options?: AndroidAppLaunchOptions,
): string[] => {
  const args = [
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.LAUNCHER',
    '-n',
    `${bundleId}/${activityName}`,
  ];

  const extras = options?.extras ?? {};

  for (const [key, value] of Object.entries(extras)) {
    if (typeof value === 'string') {
      args.push('--es', key, value);
      continue;
    }

    if (typeof value === 'boolean') {
      args.push('--ez', key, value ? 'true' : 'false');
      continue;
    }

    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `Android app launch option "${key}" must be a safe integer.`,
      );
    }

    args.push('--ei', key, value.toString());
  }

  return args;
};

export const isAppInstalled = async (
  adbId: string,
  bundleId: string,
): Promise<boolean> => {
  const { stdout } = await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    'shell',
    'pm',
    'list',
    'packages',
    bundleId,
  ]);
  return stdout.trim() !== '';
};

export const reversePort = async (
  adbId: string,
  port: number,
  hostPort: number = port,
): Promise<void> => {
  await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    'reverse',
    `tcp:${port}`,
    `tcp:${hostPort}`,
  ]);
};

export const stopApp = async (
  adbId: string,
  bundleId: string,
): Promise<void> => {
  await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    'shell',
    'am',
    'force-stop',
    bundleId,
  ]);
};

export const startApp = async (
  adbId: string,
  bundleId: string,
  activityName: string,
  options?: AndroidAppLaunchOptions,
): Promise<void> => {
  await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    ...getStartAppArgs(bundleId, activityName, options),
  ]);
};

export const getDeviceIds = async (): Promise<string[]> => {
  const { stdout } = await spawn(getAdbBinaryPath(), ['devices']);
  return stdout
    .split('\n')
    .slice(1) // Skip header
    .filter((line) => line.trim() !== '')
    .map((line) => line.split('\t')[0]);
};

export const getEmulatorName = async (
  adbId: string,
): Promise<string | null> => {
  const { stdout } = await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    'emu',
    'avd',
    'name',
  ]);
  return stdout.split('\n')[0].trim() || null;
};

export const getShellProperty = async (
  adbId: string,
  property: string,
): Promise<string | null> => {
  const { stdout } = await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    'shell',
    'getprop',
    property,
  ]);
  return stdout.trim() || null;
};

const isTransientAdbShellFailure = (error: unknown): boolean => {
  return error instanceof SubprocessError && error.exitCode === 1;
};

export type DeviceInfo = {
  manufacturer: string | null;
  model: string | null;
};

export const getDeviceInfo = async (
  adbId: string,
): Promise<DeviceInfo | null> => {
  const manufacturer = await getShellProperty(adbId, 'ro.product.manufacturer');
  const model = await getShellProperty(adbId, 'ro.product.model');
  return { manufacturer, model };
};

export const isBootCompleted = async (adbId: string): Promise<boolean> => {
  try {
    const bootCompleted = await getShellProperty(adbId, 'sys.boot_completed');
    return bootCompleted === '1';
  } catch (error) {
    if (isTransientAdbShellFailure(error)) {
      return false;
    }

    throw error;
  }
};

export const stopEmulator = async (adbId: string): Promise<void> => {
  await spawn(getAdbBinaryPath(), ['-s', adbId, 'emu', 'kill']);
};

export const installApp = async (
  adbId: string,
  appPath: string,
): Promise<void> => {
  await spawn(getAdbBinaryPath(), ['-s', adbId, 'install', '-r', appPath]);
};

export const hasAvd = async (name: string): Promise<boolean> => {
  const avds = await getAvds();
  return avds.includes(name);
};

export const createAvd = async ({
  name,
  apiLevel,
  profile,
  diskSize,
  heapSize,
}: CreateAvdOptions): Promise<void> => {
  const systemImagePackage = getAndroidSystemImagePackage(
    apiLevel,
    getHostAndroidSystemImageArch(),
  );

  await verifyAndroidEmulatorSdk(apiLevel);
  await ensureAvdProfileAvailable(profile);
  await spawn('bash', [
    '-lc',
    `printf 'no\n' | "${getAvdManagerBinaryPath()}" create avd --force --name "${name}" --package "${systemImagePackage}" --device "${profile}" -p "${getAvdDirectory(name)}"`,
  ]);
  await ensureAvdIniExists({ name, apiLevel });
  const configPath = await ensureAvdConfigExists(name);
  await spawn('bash', [
    '-lc',
    `printf '%s\n%s\n' 'disk.dataPartition.size=${diskSize}' 'vm.heapSize=${heapSize}' >> "${configPath}"`,
  ]);
};

export const deleteAvd = async (name: string): Promise<void> => {
  await rm(
    `${
      process.env.ANDROID_AVD_HOME ?? `${process.env.HOME}/.android/avd`
    }/${name}.avd`,
    {
      force: true,
      recursive: true,
    },
  );
  await rm(
    `${
      process.env.ANDROID_AVD_HOME ?? `${process.env.HOME}/.android/avd`
    }/${name}.ini`,
    {
      force: true,
    },
  );
};

export const startEmulator = async (
  name: string,
  mode: EmulatorBootMode = 'default-boot',
): Promise<void> => {
  const emulatorBinaryPath = await ensureEmulatorInstalled();
  const childProcess = emulatorProcess.startDetachedProcess(
    emulatorBinaryPath,
    getEmulatorStartupArgs(name, mode),
  );

  let stdout = '';
  let stderr = '';

  childProcess.stdout?.setEncoding('utf8');
  childProcess.stderr?.setEncoding('utf8');

  const onStdout = (chunk: string | Buffer) => {
    stdout = appendBoundedOutput(stdout, chunk.toString());
  };
  const onStderr = (chunk: string | Buffer) => {
    stderr = appendBoundedOutput(stderr, chunk.toString());
  };

  childProcess.stdout?.on('data', onStdout);
  childProcess.stderr?.on('data', onStderr);

  const startupAbortController = new AbortController();
  const cleanup = () => {
    startupAbortController.abort();
    childProcess.stdout?.off('data', onStdout);
    childProcess.stderr?.off('data', onStderr);
    childProcess.removeAllListeners('error');
    childProcess.removeAllListeners('close');
  };

  const earlyExit = new Promise<never>((_, reject) => {
    childProcess.once('error', (error) => {
      reject(
        formatEmulatorStartupError({
          name,
          stdout,
          stderr,
          error,
        }),
      );
    });

    childProcess.once('close', (exitCode, signal) => {
      reject(
        formatEmulatorStartupError({
          name,
          stdout,
          stderr,
          exitCode,
          signal,
        }),
      );
    });
  });

  const observedBoot = waitForEmulator(name, startupAbortController.signal)
    .then(() => 'booted' as const)
    .catch((error: unknown) => {
      if (startupAbortController.signal.aborted) {
        return 'aborted' as const;
      }

      throw error;
    });

  const observationTimeout = wait(EMULATOR_STARTUP_OBSERVATION_TIMEOUT_MS).then(
    () => 'timeout' as const,
  );

  try {
    await Promise.race([earlyExit, observedBoot, observationTimeout]);
  } finally {
    cleanup();
  }

  childProcess.stdout?.destroy();
  childProcess.stderr?.destroy();
  childProcess.unref();
};

export const waitForEmulator = async (
  name: string,
  signal: AbortSignal,
): Promise<string> => {
  while (!signal.aborted) {
    const adbIds = await getDeviceIds();

    for (const adbId of adbIds) {
      if (!adbId.startsWith('emulator-')) {
        continue;
      }

      const emulatorName = await getEmulatorName(adbId);

      if (emulatorName === name) {
        return adbId;
      }
    }

    await waitWithSignal(1000, signal);
  }

  throw signal.reason;
};

export const waitForEmulatorDisconnect = async (
  adbId: string,
  signal: AbortSignal,
): Promise<void> => {
  while (!signal.aborted) {
    const adbIds = await getDeviceIds();

    if (!adbIds.includes(adbId)) {
      return;
    }

    await waitWithSignal(1000, signal);
  }

  throw signal.reason;
};

export const waitForBoot = async (
  name: string,
  signal: AbortSignal,
): Promise<string> => {
  while (!signal.aborted) {
    const adbIds = await getDeviceIds();

    for (const adbId of adbIds) {
      if (!adbId.startsWith('emulator-')) {
        continue;
      }

      const emulatorName = await getEmulatorName(adbId);

      if (emulatorName !== name) {
        continue;
      }

      if (await isBootCompleted(adbId)) {
        return adbId;
      }
    }

    await waitWithSignal(1000, signal);
  }

  throw signal.reason;
};

export const isAppRunning = async (
  adbId: string,
  bundleId: string,
): Promise<boolean> => {
  try {
    const { stdout } = await spawn(getAdbBinaryPath(), [
      '-s',
      adbId,
      'shell',
      'pidof',
      bundleId,
    ]);
    return stdout.trim() !== '';
  } catch (error) {
    if (error instanceof SubprocessError && error.exitCode === 1) {
      return false;
    }

    throw error;
  }
};

export const getAppUid = async (
  adbId: string,
  bundleId: string,
): Promise<number> => {
  const { stdout } = await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    'shell',
    'pm',
    'list',
    'packages',
    '-U',
  ]);
  const line = stdout
    .split('\n')
    .find((entry) => entry.includes(`package:${bundleId}`));
  const match = line?.match(/\buid:(\d+)\b/);

  if (!match) {
    throw new Error(`Failed to resolve Android app UID for "${bundleId}".`);
  }

  return Number(match[1]);
};

export const setHideErrorDialogs = async (
  adbId: string,
  hide: boolean,
): Promise<void> => {
  await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    'shell',
    'settings',
    'put',
    'global',
    'hide_error_dialogs',
    hide ? '1' : '0',
  ]);
};

export const getLogcatTimestamp = async (adbId: string): Promise<string> => {
  const { stdout } = await spawn(getAdbBinaryPath(), [
    '-s',
    adbId,
    'shell',
    'date',
    "+'%m-%d %H:%M:%S.000'",
  ]);

  return stdout.trim().replace(/^'+|'+$/g, '');
};

export const getAvds = async (): Promise<string[]> => {
  try {
    const emulatorBinaryPath = await ensureEmulatorInstalled();
    const { stdout } = await spawn(emulatorBinaryPath, ['-list-avds']);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    return [];
  }
};

export type AdbDevice = {
  id: string;
  model: string;
  manufacturer: string;
};

export const getConnectedDevices = async (): Promise<AdbDevice[]> => {
  const { stdout } = await spawn(getAdbBinaryPath(), ['devices', '-l']);
  const lines = stdout.split('\n').slice(1);
  const devices: AdbDevice[] = [];

  for (const line of lines) {
    if (line.trim() === '') continue;

    const parts = line.split(/\s+/);
    const id = parts[0];

    // If it's an emulator, we skip it here as we handle emulators via AVDs
    if (id.startsWith('emulator-')) continue;

    // Parse model and manufacturer from 'adb devices -l' output
    // Example: 0123456789ABCDEF device usb:337641472X product:sdk_gphone64_arm64 model:Pixel_6 device:oriole transport_id:1
    const modelMatch = line.match(/model:(\S+)/);
    const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : 'Unknown';

    const manufacturer =
      (await getShellProperty(id, 'ro.product.manufacturer')) ?? 'Unknown';

    devices.push({
      id,
      model,
      manufacturer,
    });
  }

  return devices;
};
