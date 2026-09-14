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
  runCommand,
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
/**
 * Fallback prepare budget when the runner's `platformReadyTimeout` is unknown.
 * Deliberately below the 300 s default so Harness's own platform-ready timeout
 * is what surfaces, not a stuck agent-device command.
 */
const DEFAULT_PREPARE_TIMEOUT_MS = 240_000;
const MINIMUM_PREPARE_TIMEOUT_MS = 30_000;
const SESSION_CLOSE_TIMEOUT_MS = 30_000;
const DAEMON_STOP_TIMEOUT_MS = 60_000;
/** How long dispose() waits for an in-flight poll to unwind after the stop. */
const WATCHDOG_DRAIN_TIMEOUT_MS = 2_000;
/** Consecutive unclassified failures before the watchdog gives up. */
const MAX_CONSECUTIVE_UNKNOWN_FAILURES = 3;

/**
 * Buttons the watchdog is allowed to tap, in priority order. Carried over from
 * the removed in-process XCTest watchdog, which tapped the first of these
 * labels present on the prompt. `Allow While Using App` is new: it is the label
 * iOS 26 uses on the three-button location sheet.
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
/**
 * agent-device refuses to wipe a derived-data path that came from
 * `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH`, which Harness always sets. It needs
 * that wipe whenever the cached runner no longer matches the installed
 * agent-device version, Xcode or SDK, so Harness does the cleaning itself.
 */
const REFUSED_CLEAN_MESSAGE =
  'Refusing to clean AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH';
const RUNNER_BUSY_ERROR_CODE = 'RUNNER_BUSY';
const ALERT_NOT_FOUND_RUNNER_ERROR_CODE = 'ALERT_NOT_FOUND';

export type IosPermissionAgentTarget =
  | { kind: 'simulator'; udid: string }
  | { kind: 'device'; udid: string; codeSign?: ApplePhysicalDeviceCodeSign };

export type IosPermissionAgentOptions = {
  appBundleId?: string;
  target: IosPermissionAgentTarget;
  projectRoot?: string;
  /**
   * The runner's `platformReadyTimeout`. The prepare budget is derived from it
   * so a stuck agent-device command never outlives platform startup.
   */
  platformReadyTimeoutMs?: number;
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
  const [rawMajor, rawMinor] = nodeVersion
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  const major = Number.isFinite(rawMajor) ? (rawMajor as number) : Number.NaN;
  const minor = Number.isFinite(rawMinor) ? (rawMinor as number) : 0;

  // A newer major always qualifies, whatever its minor is.
  if (major > MINIMUM_NODE_MAJOR) {
    return;
  }

  if (major === MINIMUM_NODE_MAJOR && minor >= MINIMUM_NODE_MINOR) {
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

export const getPrepareTimeoutMs = (
  platformReadyTimeoutMs?: number
): number => {
  if (
    platformReadyTimeoutMs === undefined ||
    !Number.isFinite(platformReadyTimeoutMs) ||
    platformReadyTimeoutMs <= 0
  ) {
    return DEFAULT_PREPARE_TIMEOUT_MS;
  }

  // Stay clear of the platform-ready deadline so Harness's own timeout, with
  // its actionable message, is the one that fires first.
  return Math.max(
    MINIMUM_PREPARE_TIMEOUT_MS,
    Math.floor(platformReadyTimeoutMs * 0.8)
  );
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
 * inherits that process's environment for its whole lifetime. agent-device
 * 0.21.0 exposes no `daemon start` subcommand that could be handed a dedicated
 * environment (`agent-device help daemon` documents `daemon stop` only), so the
 * variables the daemon needs are written to `process.env` before the client is
 * created, and a value the user already set is never overwritten.
 */
const applyDaemonEnvironment = ({
  runnerDerivedDataPath,
  target,
}: {
  runnerDerivedDataPath: string;
  target: IosPermissionAgentTarget;
}): { ownsRunnerDerivedDataPath: boolean } => {
  const ownsRunnerDerivedDataPath =
    getTrimmedEnvironmentValue(RUNNER_DERIVED_PATH_ENV) === undefined;
  const setIfUnset = (name: string, value: string | undefined) => {
    if (value === undefined || value.length === 0) {
      return;
    }

    if (getTrimmedEnvironmentValue(name) !== undefined) {
      permissionAgentLogger.debug(
        'keeping the existing %s from the environment',
        name
      );

      return;
    }

    process.env[name] = value;
  };

  setIfUnset(RUNNER_DERIVED_PATH_ENV, runnerDerivedDataPath);

  if (target.kind === 'device' && target.codeSign) {
    const { teamId, signingIdentity, provisioningProfile, runnerBundleId } =
      target.codeSign;

    setIfUnset(IOS_TEAM_ID_ENV, teamId);
    setIfUnset(IOS_SIGNING_IDENTITY_ENV, signingIdentity);
    setIfUnset(IOS_PROVISIONING_PROFILE_ENV, provisioningProfile);
    setIfUnset(IOS_BUNDLE_ID_ENV, runnerBundleId);
  }

  return { ownsRunnerDerivedDataPath };
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

const getErrorHint = (error: unknown): string | undefined => {
  const { hint } = getErrorDetails(error);

  return typeof hint === 'string' && hint.length > 0 ? hint : undefined;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isAlertNotFoundError = (error: unknown): boolean =>
  getErrorDetails(error).runnerErrorCode === ALERT_NOT_FOUND_RUNNER_ERROR_CODE;

/**
 * Only these three are expected during a healthy run: no prompt is showing, the
 * runner is still finishing the previous command, or the round trip ran long.
 * Everything else is reported, not swallowed.
 */
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

  return /timed out|timeout/i.test(getErrorMessage(error));
};

export const isDeviceInUseError = (error: unknown): boolean =>
  getErrorCode(error) === DEVICE_IN_USE_ERROR_CODE;

export const isRefusedRunnerCleanError = (error: unknown): boolean =>
  getErrorMessage(error).includes(REFUSED_CLEAN_MESSAGE);

/**
 * A claimed device is never retried: the owner is a live agent-device session,
 * usually the developer's own, and quietly taking it over would break it.
 */
const createDeviceInUseError = (error: unknown): Error => {
  const hint = getErrorHint(error);
  const lines = [
    `agent-device cannot claim this iOS device for permission automation: ${getErrorMessage(error)}`,
  ];

  if (hint) {
    lines.push(hint);
  }

  lines.push(
    'Close the agent-device session that owns the device, or run Harness against a different device.'
  );

  return new Error(lines.join('\n'));
};

export const findLabelToTap = (
  items: readonly string[]
): string | undefined => {
  for (const positiveLabel of POSITIVE_BUTTON_LABELS) {
    // The trimmed label is what gets tapped: agent-device matches the selector
    // against the button's own label, and surrounding whitespace in the JSON
    // payload is not part of it.
    const match = items.find((item) => item.trim() === positiveLabel);

    if (match !== undefined) {
      return match.trim();
    }
  }

  return undefined;
};

/**
 * agent-device selectors are `key="value"` with no documented escape syntax, so
 * a label carrying a quote or backslash cannot be expressed safely.
 */
export const buildLabelSelector = (label: string): string | undefined => {
  if (/["\\]/.test(label)) {
    return undefined;
  }

  return `label="${label}"`;
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

  if (
    copyIfExists(
      path.join(stateDir, 'daemon.log'),
      path.join(targetDirectory, 'daemon.log')
    )
  ) {
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
  const prepareTimeoutMs = getPrepareTimeoutMs(options.platformReadyTimeoutMs);
  const daemonStopHint = `agent-device daemon stop --state-dir ${stateDir} --clean`;

  const watchdogAbortController = new AbortController();
  let client: AgentDeviceClient | null = null;
  let watchdogTask: Promise<void> | null = null;
  let appRunning = false;
  let consecutiveUnknownFailures = 0;
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  /** Reports an unclassified failure; returns true when the loop must stop. */
  const recordUnknownFailure = (context: string, error: unknown): boolean => {
    consecutiveUnknownFailures += 1;
    const code = getErrorCode(error) ?? 'UNKNOWN';
    const hint = getErrorHint(error);

    permissionAgentLogger.warn(
      'iOS permission watchdog %s failed (%s): %s%s',
      context,
      code,
      getErrorMessage(error),
      hint ? ` ${hint}` : ''
    );

    if (consecutiveUnknownFailures < MAX_CONSECUTIVE_UNKNOWN_FAILURES) {
      return false;
    }

    permissionAgentLogger.warn(
      'iOS permission automation is disabled for the rest of this run after %d consecutive failures. System permission prompts will no longer be dismissed automatically.',
      consecutiveUnknownFailures
    );

    return true;
  };

  /** Resolves false when the watchdog must stop. */
  const pollOnce = async (): Promise<boolean> => {
    if (!client) {
      return false;
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
        consecutiveUnknownFailures = 0;
        permissionAgentLogger.debug(
          'permission watchdog poll skipped: %s',
          getErrorMessage(error)
        );

        return true;
      }

      return !recordUnknownFailure('poll', error);
    }

    consecutiveUnknownFailures = 0;

    const items = getAlertItems(alertResult);
    const label = findLabelToTap(items);

    if (label === undefined) {
      permissionAgentLogger.debug(
        'no known positive button on the current prompt (items: %s)',
        items.join(', ')
      );

      return true;
    }

    const selector = buildLabelSelector(label);

    if (selector === undefined) {
      permissionAgentLogger.warn(
        'cannot tap the permission prompt button %j: its label contains a character agent-device selectors cannot express.',
        label
      );

      return true;
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
        selector,
      });
    } catch (error) {
      if (isDeviceInUseError(error)) {
        throw createDeviceInUseError(error);
      }

      if (isTransientWatchdogError(error)) {
        permissionAgentLogger.debug(
          'tapping "%s" was skipped: %s',
          label,
          getErrorMessage(error)
        );

        return true;
      }

      return !recordUnknownFailure(`tap of "${label}"`, error);
    }

    return true;
  };

  // Serialised on purpose: the runner handles one command at a time, and
  // overlapping requests are what produce RUNNER_BUSY storms.
  const runWatchdog = async (): Promise<void> => {
    const { signal } = watchdogAbortController;

    while (!signal.aborted) {
      if (appRunning) {
        let shouldContinue: boolean;

        try {
          shouldContinue = await pollOnce();
        } catch (error) {
          permissionAgentLogger.error(
            'stopping the iOS permission watchdog: %s',
            getErrorMessage(error)
          );

          return;
        }

        if (!shouldContinue) {
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

  const closeSession = async (): Promise<void> => {
    if (!client) {
      return;
    }

    // `sessions.close` takes no timeout of its own, and the daemon stop below
    // is the real guarantee, so this wait is bounded and best-effort.
    const timeout = cancellableDelay(SESSION_CLOSE_TIMEOUT_MS);

    try {
      await Promise.race([
        client.sessions.close().catch((error: unknown) => {
          permissionAgentLogger.debug(
            'failed to close the agent-device session',
            error
          );
        }),
        timeout.promise,
      ]);
    } finally {
      timeout.cancel();
    }
  };

  const stopDaemon = async (): Promise<void> => {
    let binPath: string;

    try {
      binPath = resolveAgentDeviceBinPath();
    } catch (error) {
      permissionAgentLogger.warn(
        'could not resolve the agent-device CLI, so its daemon was left running: %s Stop it with: %s',
        getErrorMessage(error),
        daemonStopHint
      );

      return;
    }

    try {
      await runCommand(
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
        {
          signal: AbortSignal.timeout(DAEMON_STOP_TIMEOUT_MS),
          timeoutMs: DAEMON_STOP_TIMEOUT_MS,
        }
      );
    } catch (error) {
      permissionAgentLogger.warn(
        'failed to stop the agent-device daemon: %s An xcodebuild or AgentDeviceRunner process may still hold the device claim. Stop it with: %s',
        getErrorMessage(error),
        daemonStopHint
      );
    }
  };

  const collectLogs = (): void => {
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
      permissionAgentLogger.debug('failed to copy agent-device logs', error);
    }
  };

  /**
   * agent-device commands take no abort signal, so cancellation is a race: the
   * caller stops waiting and the daemon is torn down, which kills the in-flight
   * xcodebuild/AgentDeviceRunner and releases the host-global device claim.
   */
  const runBounded = async <T>(
    description: string,
    work: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    if (!signal) {
      return await work();
    }

    const abortWait = waitForAbort(signal);

    try {
      return await Promise.race([work(), abortWait.promise]);
    } catch (error) {
      if (signal.aborted) {
        permissionAgentLogger.debug(
          'aborted while %s; stopping the agent-device daemon',
          description
        );
        await stopDaemon();
      }

      throw error;
    } finally {
      abortWait.cancel();
    }
  };

  return {
    prepare: async (signal) => {
      assertSupportedNodeVersion();

      const runnerDerivedDataPath = getRunnerDerivedDataPath(projectRoot);
      const { ownsRunnerDerivedDataPath } = applyDaemonEnvironment({
        runnerDerivedDataPath,
        target,
      });
      fs.mkdirSync(stateDir, { recursive: true });

      const { createAgentDeviceClient } = await import('agent-device');

      const agentDeviceClient = createAgentDeviceClient({
        stateDir,
        session: AGENT_DEVICE_SESSION_NAME,
        iosXctestrunFile: getExistingPath(XCTESTRUN_FILE_ENV),
        iosXctestDerivedDataPath: getExistingPath(
          XCTEST_DERIVED_DATA_PATH_ENV
        ),
      });

      client = agentDeviceClient;

      permissionAgentLogger.debug(
        'preparing the agent-device iOS runner for %s (state dir %s, budget %d ms)',
        target.udid,
        stateDir,
        prepareTimeoutMs
      );

      const prepareRunner = () =>
        runBounded(
          'preparing the agent-device iOS runner',
          () =>
            agentDeviceClient.command.prepare({
              action: 'ios-runner',
              platform: 'ios',
              udid: target.udid,
              timeoutMs: prepareTimeoutMs,
            }),
          signal
        );

      try {
        try {
          await prepareRunner();
        } catch (error) {
          // agent-device will not wipe a derived path it did not choose, but
          // it needs that wipe after an agent-device, Xcode or SDK upgrade.
          // The directory is Harness's own cache, so clear it and retry once
          // rather than failing every run until someone deletes it by hand.
          if (!isRefusedRunnerCleanError(error) || !ownsRunnerDerivedDataPath) {
            throw error;
          }

          logger.info(
            'Rebuilding the cached iOS UI test runner (it no longer matches the installed agent-device or Xcode)...'
          );
          permissionAgentLogger.debug(
            'clearing the stale runner cache at %s',
            runnerDerivedDataPath
          );
          fs.rmSync(runnerDerivedDataPath, { recursive: true, force: true });

          await prepareRunner();
        }

        await runBounded(
          'opening the agent-device SpringBoard session',
          () =>
            agentDeviceClient.apps.open({
              app: SPRINGBOARD_BUNDLE_ID,
              platform: 'ios',
              udid: target.udid,
              timeoutMs: prepareTimeoutMs,
            }),
          signal
        );
      } catch (error) {
        if (isDeviceInUseError(error)) {
          throw createDeviceInUseError(error);
        }

        throw error;
      }

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

        // Tear the daemon down first: an in-flight `alert get` can still have
        // most of its 20 s budget left, and stopping the daemon ends it
        // immediately instead of making teardown wait it out.
        await closeSession();
        client = null;
        await stopDaemon();

        if (watchdogTask) {
          const drain = cancellableDelay(WATCHDOG_DRAIN_TIMEOUT_MS);

          try {
            await Promise.race([
              watchdogTask.catch(() => undefined),
              drain.promise,
            ]);
          } finally {
            drain.cancel();
          }

          watchdogTask = null;
        }

        collectLogs();
      })()),
  };
};
