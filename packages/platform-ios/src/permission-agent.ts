import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHarnessArtifactDirectory,
  delay as cancellableDelay,
  getHarnessCacheArtifactPath,
  logger,
  spawn,
  waitForAbort,
} from '@react-native-harness/tools';
import type { ApplePhysicalDeviceCodeSign } from './config.js';

const permissionAgentLogger = logger.child('ios-permission-agent');

type AgentDeviceModule = typeof import('agent-device');
type AgentDeviceClient = ReturnType<
  AgentDeviceModule['createAgentDeviceClient']
>;

/** agent-device 0.21.0 declares `engines.node: ">=22.12"`. */
const MINIMUM_NODE_MAJOR = 22;
const MINIMUM_NODE_MINOR = 12;

const WATCHDOG_INTERVAL_MS_ENV = 'HARNESS_PERMISSION_WATCHDOG_INTERVAL_MS';
/** Accepted alias kept from the removed in-process XCTest agent. */
const LEGACY_WATCHDOG_INTERVAL_MS_ENV = 'HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS';
const XCTESTRUN_FILE_ENV = 'HARNESS_IOS_XCTESTRUN_FILE';
const XCTEST_DERIVED_DATA_PATH_ENV = 'HARNESS_IOS_XCTEST_DERIVED_DATA_PATH';
const RUNNER_DERIVED_PATH_ENV = 'AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH';
const IOS_TEAM_ID_ENV = 'AGENT_DEVICE_IOS_TEAM_ID';
const IOS_SIGNING_IDENTITY_ENV = 'AGENT_DEVICE_IOS_SIGNING_IDENTITY';
const IOS_PROVISIONING_PROFILE_ENV = 'AGENT_DEVICE_IOS_PROVISIONING_PROFILE';
const IOS_BUNDLE_ID_ENV = 'AGENT_DEVICE_IOS_BUNDLE_ID';

const RUNNER_CACHE_ARTIFACT_NAME = 'agent-device-runner';
const AGENT_DEVICE_SESSION_NAME = 'harness';
/**
 * The session is bound to SpringBoard, never to the app under test: Harness
 * keeps sole ownership of launching, killing and relaunching that app.
 * agent-device needs *some* open session because `interactions.press` refuses
 * to run session-less (`SESSION_NOT_FOUND`), unlike `command.alert`, which
 * attaches an implicit runner session per call. Binding to SpringBoard also
 * matches where blocking system modals actually live.
 */
const SPRINGBOARD_BUNDLE_ID = 'com.apple.springboard';
const DEFAULT_WATCHDOG_INTERVAL_MS = 1000;
/**
 * One `alert get` round trip costs ~4 s against a normal app screen, so the
 * per-command budget has to leave generous headroom above that before a poll
 * is treated as a (transient) timeout.
 */
const ALERT_COMMAND_TIMEOUT_MS = 20_000;
const PREPARE_COMMAND_TIMEOUT_MS = 600_000;
const DAEMON_STOP_TIMEOUT_MS = 60_000;

/**
 * Buttons the watchdog is allowed to tap, in priority order. Carried over
 * verbatim from the removed in-process XCTest watchdog, which tapped the first
 * of these labels present on the prompt.
 */
const POSITIVE_BUTTON_LABELS = [
  'Allow',
  'OK',
  'Continue',
  'Next',
  'While Using App',
  'While Using the App',
  'Always Allow',
  'Allow Once',
  'Allow While Using App',
  'Join',
  'Pair',
  'Allow Full Access',
] as const;

const DEVICE_IN_USE_ERROR_CODE = 'DEVICE_IN_USE';
const RUNNER_BUSY_ERROR_CODE = 'RUNNER_BUSY';
const ALERT_NOT_FOUND_RUNNER_ERROR_CODE = 'ALERT_NOT_FOUND';

export type IosPermissionAgentTarget =
  | { kind: 'simulator'; udid: string }
  | { kind: 'device'; udid: string; codeSign?: ApplePhysicalDeviceCodeSign };

export type IosPermissionAgentOptions = {
  appBundleId?: string;
  target: IosPermissionAgentTarget;
  projectRoot?: string;
};

export type IosPermissionAgent = {
  /**
   * Builds/attaches the agent-device iOS runner. Must be called after the
   * device is booted and the app under test is installed.
   */
  prepare: (signal?: AbortSignal) => Promise<void>;
  /**
   * Gates the watchdog. Polling with SpringBoard's home screen foregrounded
   * walks the whole icon grid and trips the runner's main-thread watchdog, so
   * the loop only runs while the app under test is up.
   */
  setAppRunning: (running: boolean) => void;
  dispose: () => Promise<void>;
};

export const assertSupportedNodeVersion = (
  nodeVersion = process.versions.node
): void => {
  const [major, minor] = nodeVersion
    .split('.')
    .map((part) => Number.parseInt(part, 10));

  if (
    Number.isFinite(major) &&
    Number.isFinite(minor) &&
    ((major as number) > MINIMUM_NODE_MAJOR ||
      ((major as number) === MINIMUM_NODE_MAJOR &&
        (minor as number) >= MINIMUM_NODE_MINOR))
  ) {
    return;
  }

  throw new Error(
    `iOS permission automation requires Node.js ${MINIMUM_NODE_MAJOR}.${MINIMUM_NODE_MINOR} or newer, but this process runs Node.js ${nodeVersion}. Upgrade Node.js, or set \`permissions: false\` for this runner.`
  );
};

const getTrimmedEnvironmentValue = (name: string): string | undefined => {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
};

export const getPermissionWatchdogIntervalMs = (): number => {
  const rawValue =
    getTrimmedEnvironmentValue(WATCHDOG_INTERVAL_MS_ENV) ??
    getTrimmedEnvironmentValue(LEGACY_WATCHDOG_INTERVAL_MS_ENV);

  if (rawValue === undefined) {
    return DEFAULT_WATCHDOG_INTERVAL_MS;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    permissionAgentLogger.debug(
      'ignoring invalid permission watchdog interval %s',
      rawValue
    );

    return DEFAULT_WATCHDOG_INTERVAL_MS;
  }

  return parsed;
};

/**
 * Harness runs its own agent-device daemon so it never replaces, or inherits
 * stale signing environment from, a developer's own daemon. Device claims are
 * host-global, so arbitration between the two stays correct.
 */
export const getAgentDeviceStateDir = (projectRoot: string): string => {
  const projectHash = createHash('sha256')
    .update(path.resolve(projectRoot))
    .digest('hex')
    .slice(0, 16);

  return path.join(os.homedir(), '.agent-device', 'harness', projectHash);
};

export const getRunnerDerivedDataPath = (projectRoot: string): string =>
  getHarnessCacheArtifactPath(RUNNER_CACHE_ARTIFACT_NAME, projectRoot);

const getExistingPath = (name: string): string | undefined => {
  const value = getTrimmedEnvironmentValue(name);

  if (value === undefined) {
    return undefined;
  }

  if (!fs.existsSync(value)) {
    throw new Error(
      `Missing external XCTest artifact at ${value}. Check ${name}.`
    );
  }

  return value;
};

/**
 * The agent-device daemon is spawned lazily by the first client request and
 * inherits that process's environment. agent-device 0.21.0 exposes no
 * `daemon start` subcommand that could be handed a dedicated environment
 * (`agent-device help daemon` documents `daemon stop` only), so the variables
 * the daemon needs are written to `process.env` before the client is created.
 */
const applyDaemonEnvironment = ({
  runnerDerivedDataPath,
  target,
}: {
  runnerDerivedDataPath: string;
  target: IosPermissionAgentTarget;
}): void => {
  if (getTrimmedEnvironmentValue(RUNNER_DERIVED_PATH_ENV) === undefined) {
    process.env[RUNNER_DERIVED_PATH_ENV] = runnerDerivedDataPath;
  }

  if (target.kind !== 'device' || !target.codeSign) {
    return;
  }

  const { teamId, signingIdentity, provisioningProfile, runnerBundleId } =
    target.codeSign;

  process.env[IOS_TEAM_ID_ENV] = teamId;

  if (signingIdentity) {
    process.env[IOS_SIGNING_IDENTITY_ENV] = signingIdentity;
  }

  if (provisioningProfile) {
    process.env[IOS_PROVISIONING_PROFILE_ENV] = provisioningProfile;
  }

  if (runnerBundleId) {
    process.env[IOS_BUNDLE_ID_ENV] = runnerBundleId;
  }
};

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code?: unknown };

    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
};

const getErrorDetails = (error: unknown): Record<string, unknown> => {
  if (typeof error === 'object' && error !== null && 'details' in error) {
    const { details } = error as { details?: unknown };

    if (typeof details === 'object' && details !== null) {
      return details as Record<string, unknown>;
    }
  }

  return {};
};

const isAlertNotFoundError = (error: unknown): boolean =>
  getErrorDetails(error).runnerErrorCode === ALERT_NOT_FOUND_RUNNER_ERROR_CODE;

const isTransientWatchdogError = (error: unknown): boolean => {
  if (isAlertNotFoundError(error)) {
    return true;
  }

  const code = getErrorCode(error);

  if (code === RUNNER_BUSY_ERROR_CODE) {
    return true;
  }

  if (typeof code === 'string' && code.includes('TIMEOUT')) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /timed out|timeout/i.test(message);
};

export const isDeviceInUseError = (error: unknown): boolean =>
  getErrorCode(error) === DEVICE_IN_USE_ERROR_CODE;

/**
 * A claimed device is never retried: the owner is a live agent-device session,
 * usually the developer's own, and quietly taking it over would break it.
 */
const createDeviceInUseError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  const hint = getErrorDetails(error).hint;
  const lines = [
    `agent-device cannot claim this iOS device for permission automation: ${message}`,
  ];

  if (typeof hint === 'string' && hint.length > 0) {
    lines.push(hint);
  }

  lines.push(
    'Close the agent-device session that owns the device, or run Harness against a different device.'
  );

  return new Error(lines.join('\n'));
};

const findLabelToTap = (items: readonly string[]): string | undefined => {
  for (const positiveLabel of POSITIVE_BUTTON_LABELS) {
    const match = items.find((item) => item.trim() === positiveLabel);

    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
};

const getAlertItems = (result: unknown): string[] => {
  if (typeof result !== 'object' || result === null) {
    return [];
  }

  const { items } = result as { items?: unknown };

  if (!Array.isArray(items)) {
    return [];
  }

  return items.filter((item): item is string => typeof item === 'string');
};

const getAlertMessage = (result: unknown): string => {
  if (typeof result === 'object' && result !== null) {
    const { message } = result as { message?: unknown };

    if (typeof message === 'string') {
      return message;
    }
  }

  return '';
};

/**
 * Resolves the package's own CLI entry point, which is the only way to stop
 * the daemon: the Node client exposes no daemon-stop method. `agent-device`'s
 * `exports` map covers neither `./package.json` nor `./bin/*`, so the package
 * root is found by walking `node_modules` upwards from this module instead of
 * through the resolver.
 */
export const resolveAgentDeviceBinPath = (
  startDirectory = path.dirname(fileURLToPath(import.meta.url))
): string => {
  let directory = startDirectory;

  while (true) {
    const packageRoot = path.join(directory, 'node_modules', 'agent-device');

    if (fs.existsSync(path.join(packageRoot, 'package.json'))) {
      return path.join(packageRoot, 'bin', 'agent-device.mjs');
    }

    const parent = path.dirname(directory);

    if (parent === directory) {
      throw new Error(
        'Could not locate the agent-device package; reinstall the project dependencies.'
      );
    }

    directory = parent;
  }
};

const copyIfExists = (sourcePath: string, targetPath: string): boolean => {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.copyFileSync(sourcePath, targetPath);

  return true;
};

/**
 * xcodebuild output no longer lands in the Harness logs directory; it lives in
 * the agent-device session's `runner.log`. Copy both daemon-owned logs into the
 * Harness logs artifact directory so CI keeps uploading them.
 */
export const copyAgentDeviceLogs = ({
  stateDir,
  targetDirectory,
}: {
  stateDir: string;
  targetDirectory: string;
}): string[] => {
  const copied: string[] = [];

  if (copyIfExists(path.join(stateDir, 'daemon.log'), path.join(targetDirectory, 'daemon.log'))) {
    copied.push('daemon.log');
  }

  const sessionsDir = path.join(stateDir, 'sessions');

  if (!fs.existsSync(sessionsDir)) {
    return copied;
  }

  const sessionDirectories = fs
    .readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const [index, sessionDirectory] of sessionDirectories.entries()) {
    const fileName = index === 0 ? 'runner.log' : `runner-${index}.log`;

    if (
      copyIfExists(
        path.join(sessionsDir, sessionDirectory, 'runner.log'),
        path.join(targetDirectory, fileName)
      )
    ) {
      copied.push(fileName);
    }
  }

  return copied;
};

export const createIosPermissionAgent = (
  options: IosPermissionAgentOptions
): IosPermissionAgent => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const { target } = options;
  const stateDir = getAgentDeviceStateDir(projectRoot);
  const intervalMs = getPermissionWatchdogIntervalMs();

  const watchdogAbortController = new AbortController();
  let client: AgentDeviceClient | null = null;
  let watchdogTask: Promise<void> | null = null;
  let appRunning = false;
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  const pollOnce = async (): Promise<void> => {
    if (!client) {
      return;
    }

    let alertResult: unknown;

    try {
      alertResult = await client.command.alert({
        action: 'get',
        platform: 'ios',
        udid: target.udid,
        timeoutMs: ALERT_COMMAND_TIMEOUT_MS,
      });
    } catch (error) {
      if (isDeviceInUseError(error)) {
        throw createDeviceInUseError(error);
      }

      if (isTransientWatchdogError(error)) {
        permissionAgentLogger.debug(
          'permission watchdog poll skipped: %s',
          error instanceof Error ? error.message : String(error)
        );

        return;
      }

      permissionAgentLogger.debug('permission watchdog poll failed', error);

      return;
    }

    const items = getAlertItems(alertResult);
    const label = findLabelToTap(items);

    if (label === undefined) {
      permissionAgentLogger.debug(
        'no known positive button on the current prompt (items: %s)',
        items.join(', ')
      );

      return;
    }

    permissionAgentLogger.debug(
      'tapping "%s" on permission prompt "%s"',
      label,
      getAlertMessage(alertResult)
    );

    try {
      await client.interactions.press({
        platform: 'ios',
        udid: target.udid,
        selector: `label="${label}"`,
      });
    } catch (error) {
      if (isDeviceInUseError(error)) {
        throw createDeviceInUseError(error);
      }

      permissionAgentLogger.debug(
        'failed to tap "%s" on the permission prompt',
        label,
        error
      );
    }
  };

  // Serialised on purpose: the runner handles one command at a time, and
  // overlapping requests are what produce RUNNER_BUSY storms.
  const runWatchdog = async (): Promise<void> => {
    const { signal } = watchdogAbortController;

    while (!signal.aborted) {
      if (appRunning) {
        try {
          await pollOnce();
        } catch (error) {
          permissionAgentLogger.error(
            'stopping the iOS permission watchdog: %s',
            error instanceof Error ? error.message : String(error)
          );

          return;
        }
      }

      if (signal.aborted) {
        return;
      }

      // The interval is the gap between calls, not a fixed period, so a slow
      // round trip never queues another poll behind itself.
      const tick = cancellableDelay(intervalMs);
      const abortWait = waitForAbort(signal);

      try {
        await Promise.race([tick.promise, abortWait.promise]);
      } catch {
        return;
      } finally {
        tick.cancel();
        abortWait.cancel();
      }
    }
  };

  const stopDaemon = async (): Promise<void> => {
    let binPath: string;

    try {
      binPath = resolveAgentDeviceBinPath();
    } catch (error) {
      permissionAgentLogger.debug('could not resolve the agent-device CLI', error);

      return;
    }

    try {
      await spawn(
        process.execPath,
        [
          binPath,
          'daemon',
          'stop',
          '--state-dir',
          stateDir,
          '--clean',
          '--json',
        ],
        { timeout: DAEMON_STOP_TIMEOUT_MS }
      );
    } catch (error) {
      permissionAgentLogger.debug('failed to stop the agent-device daemon', error);
    }
  };

  return {
    prepare: async (signal) => {
      assertSupportedNodeVersion();

      const runnerDerivedDataPath = getRunnerDerivedDataPath(projectRoot);
      applyDaemonEnvironment({ runnerDerivedDataPath, target });
      fs.mkdirSync(stateDir, { recursive: true });

      const { createAgentDeviceClient } = await import('agent-device');

      client = createAgentDeviceClient({
        stateDir,
        session: AGENT_DEVICE_SESSION_NAME,
        iosXctestrunFile: getExistingPath(XCTESTRUN_FILE_ENV),
        iosXctestDerivedDataPath: getExistingPath(
          XCTEST_DERIVED_DATA_PATH_ENV
        ),
      });

      permissionAgentLogger.debug(
        'preparing the agent-device iOS runner for %s (state dir %s)',
        target.udid,
        stateDir
      );

      try {
        await client.command.prepare({
          action: 'ios-runner',
          platform: 'ios',
          udid: target.udid,
          timeoutMs: PREPARE_COMMAND_TIMEOUT_MS,
        });
        await client.apps.open({
          app: SPRINGBOARD_BUNDLE_ID,
          platform: 'ios',
          udid: target.udid,
          timeoutMs: PREPARE_COMMAND_TIMEOUT_MS,
        });
      } catch (error) {
        if (isDeviceInUseError(error)) {
          throw createDeviceInUseError(error);
        }

        throw error;
      }

      signal?.throwIfAborted();

      watchdogTask = runWatchdog();
    },
    setAppRunning: (running) => {
      appRunning = running;
    },
    dispose: () =>
      (disposePromise ??= (async () => {
        if (disposed) {
          return;
        }

        disposed = true;
        appRunning = false;
        watchdogAbortController.abort();

        if (watchdogTask) {
          await watchdogTask.catch(() => undefined);
          watchdogTask = null;
        }

        client = null;

        await stopDaemon();

        try {
          const logArtifacts = createHarnessArtifactDirectory({
            artifactType: 'logs',
            bundleId: options.appBundleId,
            platformId: 'ios',
            runnerName: `permission-agent-${target.kind}`,
          });
          const copied = copyAgentDeviceLogs({
            stateDir,
            targetDirectory: logArtifacts.directoryPath,
          });

          if (copied.length > 0) {
            permissionAgentLogger.debug(
              'copied agent-device logs (%s) to %s',
              copied.join(', '),
              logArtifacts.directoryPath
            );
          }
        } catch (error) {
          permissionAgentLogger.debug(
            'failed to copy agent-device logs',
            error
          );
        }
      })()),
  };
};
