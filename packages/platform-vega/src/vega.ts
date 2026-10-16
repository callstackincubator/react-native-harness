import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  delay,
  logger,
  runCommand,
  spawnOwnedProcess,
  SubprocessError,
  waitForAbort,
  withAbortTimeout,
  type OwnedProcess,
} from '@react-native-harness/tools';
import { DependencyNotFoundError } from '@react-native-harness/platforms';
import { VegaVdaSerialError } from './errors.js';

const log = logger.child('platform-vega');

// The SDK ships the CLI as "vega"; older SDKs called it "kepler".
const VEGA_CLI_NAMES = ['vega', 'kepler'] as const;
const VDA_BINARY_NAME = 'vda';
const SDK_PATH_ENV = 'KEPLER_SDK_PATH';
const CLI_PATH_ENV = 'VEGA_CLI_PATH';
const INSTALL_HINT =
  'Install the Vega SDK (https://developer.amazon.com/docs/vega/0.24/install-vega-sdk), then run "source ~/vega/env" or set KEPLER_SDK_PATH so the "vega" CLI can be found.';

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const VIRTUAL_DEVICE_START_TIMEOUT_MS = 5 * 60_000;
const VIRTUAL_DEVICE_POLL_INTERVAL_MS = 1000;
// The device transport flaps for a moment after boot, so readiness needs a
// few consecutive answers before the device is trusted.
const VIRTUAL_DEVICE_READY_PROBES = 3;
const INSTALL_ATTEMPTS = 3;
const INSTALL_RETRY_DELAY_MS = 2000;

export type VegaDeviceEntry = {
  id: string;
  description: string;
  isVirtual: boolean;
};

type CommandOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

let cachedVegaBinary: string | null | undefined;

const getExecutableCandidates = (name: string, dir: string): string[] =>
  process.platform === 'win32'
    ? [`${name}.exe`, `${name}.cmd`, name].map((file) => path.join(dir, file))
    : [path.join(dir, name)];

const findExecutable = (names: readonly string[], dirs: string[]) => {
  for (const dir of dirs) {
    for (const name of names) {
      for (const candidate of getExecutableCandidates(name, dir)) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
};

const getSearchDirs = (): string[] => {
  const pathDirs = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  const sdkPath = process.env[SDK_PATH_ENV];
  const home = os.homedir();

  return [
    ...pathDirs,
    ...(sdkPath ? [path.join(sdkPath, 'bin')] : []),
    path.join(home, 'vega', 'bin'),
    path.join(home, 'vega', 'sdk', 'bin'),
  ];
};

export const resolveVegaBinary = (): string | null => {
  if (cachedVegaBinary !== undefined) {
    return cachedVegaBinary;
  }

  const explicit = process.env[CLI_PATH_ENV];
  cachedVegaBinary = explicit || findExecutable(VEGA_CLI_NAMES, getSearchDirs());

  return cachedVegaBinary;
};

export const resetVegaBinaryCache = (): void => {
  cachedVegaBinary = undefined;
};

const getVegaBinary = (): string => {
  const binary = resolveVegaBinary();

  if (!binary) {
    throw new DependencyNotFoundError('vega', INSTALL_HINT);
  }

  return binary;
};

/**
 * Locates the Vega Device Adaptor. The SDK keeps it deep inside its workspace
 * tree, so ask the CLI first and only then scan the usual bin directories.
 */
export const getVdaBinaryPath = async (): Promise<string | null> => {
  const { ok, stdout } = await runVegaQuietly(['which', VDA_BINARY_NAME]);

  if (ok) {
    const reported = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => path.isAbsolute(line) && fs.existsSync(line))
      .pop();

    if (reported) {
      return reported;
    }
  }

  const vegaBinary = resolveVegaBinary();
  const dirs = [
    ...(vegaBinary ? [path.dirname(vegaBinary)] : []),
    ...getSearchDirs(),
  ];

  return findExecutable([VDA_BINARY_NAME], dirs);
};

export const ensureVegaCliAvailable = async (): Promise<void> => {
  const binary = getVegaBinary();

  try {
    const { stdout } = await runCommand(binary, ['--version'], {
      signal: new AbortController().signal,
      timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    });
    log.debug('using Vega CLI %s (%s)', binary, stdout.trim());
  } catch (error) {
    log.debug('Vega CLI %s did not report a version: %s', binary, error);
  }
};

const runVega = async (
  args: readonly string[],
  { signal, timeoutMs }: CommandOptions = {}
) =>
  runCommand(getVegaBinary(), args, {
    signal: signal ?? new AbortController().signal,
    timeoutMs: timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
  });

// Only stdout is inspected: the CLI logs progress to stderr.
const runVegaQuietly = async (
  args: readonly string[],
  options?: CommandOptions
): Promise<{ ok: boolean; stdout: string }> => {
  try {
    const { stdout } = await runVega(args, options);
    return { ok: true, stdout };
  } catch (error) {
    log.debug('vega %s failed: %s', args.join(' '), error);
    return { ok: false, stdout: '' };
  }
};

const deviceArgs = (deviceId: string) => ['--device', deviceId];

/**
 * Parses `vega device list` output. Each device is printed as
 * `<id> : <description>`, e.g. `VirtualDevice : tv - x86_64 - OS - host`.
 */
export const parseDeviceList = (stdout: string): VegaDeviceEntry[] => {
  const entries: VegaDeviceEntry[] = [];

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    const separator = line.indexOf(' : ');

    if (!line || separator === -1) {
      continue;
    }

    const id = line.slice(0, separator).trim();
    const description = line.slice(separator + 3).trim();

    if (!id) {
      continue;
    }

    entries.push({
      id,
      description,
      isVirtual:
        id === 'VirtualDevice' || /virtual\s*device/i.test(description),
    });
  }

  return entries;
};

export const listDevices = async (): Promise<VegaDeviceEntry[]> => {
  const { ok, stdout } = await runVegaQuietly(['device', 'list']);
  return ok ? parseDeviceList(stdout) : [];
};

const findVirtualDeviceEntry = (
  entries: VegaDeviceEntry[],
  preferredId: string
): VegaDeviceEntry | undefined => {
  const exact = entries.find((entry) => entry.id === preferredId);

  if (exact) {
    return exact;
  }

  const virtual = entries.filter((entry) => entry.isVirtual);
  return virtual.length === 1 ? virtual[0] : undefined;
};

export const isDeviceConnected = async (deviceId: string): Promise<boolean> => {
  const { ok, stdout } = await runVegaQuietly([
    'device',
    'is-connected',
    ...deviceArgs(deviceId),
  ]);

  return ok && !/not connected|false/i.test(stdout);
};

/**
 * Returns the id of the connected virtual device matching `preferredId`, or
 * the only virtual device listed when the preferred name is not found.
 */
export const findConnectedVirtualDevice = async (
  preferredId: string
): Promise<string | null> => {
  const entry = findVirtualDeviceEntry(await listDevices(), preferredId);

  if (!entry) {
    return null;
  }

  return (await isDeviceConnected(entry.id)) ? entry.id : null;
};

export const startVirtualDevice = async ({
  signal,
  gui,
}: {
  signal: AbortSignal;
  gui: boolean;
}): Promise<void> => {
  await runVega(
    [
      'virtual-device',
      'start',
      '--timeout',
      String(Math.floor(VIRTUAL_DEVICE_START_TIMEOUT_MS / 1000)),
      ...(gui ? [] : ['--no-gui']),
    ],
    { signal, timeoutMs: VIRTUAL_DEVICE_START_TIMEOUT_MS }
  );
};

/**
 * The device answers `is-connected` before its package manager accepts
 * installs, so readiness is probed with a command that goes through it.
 */
export const isDeviceReady = async (deviceId: string): Promise<boolean> => {
  const { ok } = await runVegaQuietly([
    'device',
    'installed-apps',
    ...deviceArgs(deviceId),
  ]);

  return ok;
};

export const stopVirtualDevice = async (): Promise<void> => {
  await runVegaQuietly(['virtual-device', 'stop'], {
    timeoutMs: VIRTUAL_DEVICE_START_TIMEOUT_MS,
  });
};

const waitWithSignal = async (
  ms: number,
  signal: AbortSignal
): Promise<void> => {
  if (signal.aborted) {
    throw signal.reason;
  }

  const timer = delay(ms);
  const abort = waitForAbort(signal);
  try {
    await Promise.race([timer.promise, abort.promise]);
  } finally {
    timer.cancel();
    abort.cancel();
  }
};

export const waitForVirtualDevice = async (
  preferredId: string,
  signal: AbortSignal,
  {
    pollIntervalMs = VIRTUAL_DEVICE_POLL_INTERVAL_MS,
    timeoutMs = VIRTUAL_DEVICE_START_TIMEOUT_MS,
  }: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<string> => {
  // Bounded on its own so the polling stops even when the caller's timeout
  // fires without aborting `signal`.
  const bounded = withAbortTimeout(signal, timeoutMs);
  let readyProbes = 0;

  for (;;) {
    if (bounded.aborted) {
      if (signal.aborted) {
        throw signal.reason;
      }

      throw new Error(
        `Vega virtual device "${preferredId}" did not become ready within ${timeoutMs} ms`
      );
    }

    const deviceId = await findConnectedVirtualDevice(preferredId);
    readyProbes = deviceId && (await isDeviceReady(deviceId)) ? readyProbes + 1 : 0;

    if (deviceId && readyProbes >= VIRTUAL_DEVICE_READY_PROBES) {
      return deviceId;
    }

    try {
      await waitWithSignal(pollIntervalMs, bounded);
    } catch (error) {
      if (!bounded.aborted) {
        throw error;
      }
    }
  }
};

export type VegaBuildType = 'Debug' | 'Release';

/**
 * Installs or updates a package in place. The build type must match the
 * package variant: without "Debug" the device skips the debug sandbox
 * overrides and a debug app cannot reach the dev server, so it gets killed as
 * unresponsive after launch. Retries cover the transport dropping for a moment
 * right after the device boots.
 */
export const installApp = async (
  deviceId: string,
  packagePath: string,
  {
    signal,
    buildType,
    attempts = INSTALL_ATTEMPTS,
    retryDelayMs = INSTALL_RETRY_DELAY_MS,
  }: {
    signal: AbortSignal;
    buildType: VegaBuildType;
    attempts?: number;
    retryDelayMs?: number;
  }
): Promise<void> => {
  const args = [
    'device',
    'install-app',
    ...deviceArgs(deviceId),
    '--packagePath',
    packagePath,
    '--buildType',
    buildType,
  ];

  for (let attempt = 1; ; attempt += 1) {
    try {
      await runVega(args, { signal, timeoutMs: INSTALL_TIMEOUT_MS });
      return;
    } catch (error) {
      const stderr =
        error instanceof SubprocessError ? error.stderr.trim() : String(error);

      if (attempt >= attempts || signal.aborted) {
        throw new Error(
          `Installing ${packagePath} on ${deviceId} failed after ${attempt} attempt(s): ${stderr}`
        );
      }

      log.debug('install attempt %d failed, retrying: %s', attempt, stderr);
      await waitWithSignal(retryDelayMs, signal);
    }
  }
};

// Every --appName flag of the Vega CLI takes the interactive component id.
export type VegaAppRunState = 'running' | 'stopped' | 'unknown';

const NEGATIVE_ANSWER = /\bfalse\b|not installed|not running/i;
const POSITIVE_ANSWER = /\btrue\b|is installed|is running/i;

/**
 * Asks the CLI about an app and keeps "the probe failed" apart from "the app
 * is gone": a non-zero exit, a timeout, or an unparseable answer is `unknown`,
 * so callers polling for an exit can retry instead of reporting a crash.
 */
const getAppState = async (
  command: 'is-app-installed' | 'is-app-running',
  deviceId: string,
  appName: string
): Promise<VegaAppRunState> => {
  const { ok, stdout } = await runVegaQuietly([
    'device',
    command,
    ...deviceArgs(deviceId),
    '--appName',
    appName,
  ]);

  if (!ok) {
    return 'unknown';
  }

  if (NEGATIVE_ANSWER.test(stdout)) {
    return 'stopped';
  }

  return POSITIVE_ANSWER.test(stdout) || stdout.trim() === '' ? 'running' : 'unknown';
};

export const isAppInstalled = async (
  deviceId: string,
  componentId: string
): Promise<boolean> =>
  (await getAppState('is-app-installed', deviceId, componentId)) === 'running';

export const getAppRunState = (deviceId: string, componentId: string) =>
  getAppState('is-app-running', deviceId, componentId);

export const launchApp = async (
  deviceId: string,
  componentId: string
): Promise<void> => {
  await runVega([
    'device',
    'launch-app',
    ...deviceArgs(deviceId),
    '--appName',
    componentId,
  ]);
};

export const terminateApp = async (
  deviceId: string,
  componentId: string
): Promise<void> => {
  await runVegaQuietly([
    'device',
    'terminate-app',
    ...deviceArgs(deviceId),
    '--appName',
    componentId,
  ]);
};

const portForwardingArgs = (deviceId: string, port: number) => [
  ...deviceArgs(deviceId),
  '--port',
  String(port),
  // "--forward false" maps the device port to the host (reverse forwarding).
  '--forward',
  'false',
];

/**
 * Starts reverse port forwarding so the device reaches Metro on `localhost`.
 * The CLI keeps running while the forwarding is active, so the caller owns
 * the process for the lifetime of the run.
 */
export const startPortForwarding = (
  deviceId: string,
  port: number
): OwnedProcess =>
  spawnOwnedProcess(
    getVegaBinary(),
    ['device', 'start-port-forwarding', ...portForwardingArgs(deviceId, port)],
    { stdout: 'pipe', stderr: 'pipe' }
  );

export const stopPortForwarding = async (
  deviceId: string,
  port: number
): Promise<void> => {
  await runVegaQuietly([
    'device',
    'stop-port-forwarding',
    ...portForwardingArgs(deviceId, port),
  ]);
};

const getVdaBinary = async (): Promise<string> => {
  const vda = await getVdaBinaryPath();

  if (!vda) {
    throw new DependencyNotFoundError(VDA_BINARY_NAME, INSTALL_HINT);
  }

  return vda;
};

const runVda = (vda: string, args: readonly string[]) =>
  runCommand(vda, args, {
    signal: new AbortController().signal,
    timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
  });

/** Parses `vda devices`, which prints one `<serial>\t<state>` line per device. */
export const parseVdaDevices = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^List of devices/i.test(line))
    .map((line) => line.split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([serial]) => serial);

/**
 * Finds the vda serial for a device known to the Vega CLI. vda uses adb-style
 * serials, which only match the CLI's ids for physical devices; the virtual
 * device shows up as `emulator-<port>`.
 */
export const resolveVdaSerial = async (
  deviceId: string,
  isVirtual: boolean
): Promise<string> => {
  const vda = await getVdaBinary();
  const { stdout } = await runVda(vda, ['devices']);
  const serials = parseVdaDevices(stdout);

  if (serials.length === 1) {
    return serials[0];
  }

  if (serials.includes(deviceId)) {
    return deviceId;
  }

  const emulators = serials.filter((serial) => serial.startsWith('emulator-'));

  if (isVirtual && emulators.length === 1) {
    return emulators[0];
  }

  throw new VegaVdaSerialError(deviceId, serials);
};

/** Maps `devicePort` on the device to `hostPort` on the host using vda. */
export const vdaReverse = async (
  serial: string,
  devicePort: number,
  hostPort: number
): Promise<void> => {
  const vda = await getVdaBinary();
  await runVda(vda, [
    '-s',
    serial,
    'reverse',
    `tcp:${devicePort}`,
    `tcp:${hostPort}`,
  ]);
};

/** Removes a reverse mapping created by `vdaReverse`. */
export const vdaRemoveReverse = async (
  serial: string,
  devicePort: number
): Promise<void> => {
  const vda = await getVdaBinaryPath();

  if (!vda) {
    return;
  }

  try {
    await runVda(vda, ['-s', serial, 'reverse', '--remove', `tcp:${devicePort}`]);
  } catch (error) {
    log.debug('vda reverse --remove tcp:%d failed: %s', devicePort, error);
  }
};

export const startLogStream = (deviceId: string): OwnedProcess =>
  spawnOwnedProcess(
    getVegaBinary(),
    ['device', 'start-log-stream', ...deviceArgs(deviceId)],
    { stdout: 'pipe', stderr: 'pipe' }
  );

export const stopLogStream = async (deviceId: string): Promise<void> => {
  await runVegaQuietly(['device', 'stop-log-stream', ...deviceArgs(deviceId)]);
};
