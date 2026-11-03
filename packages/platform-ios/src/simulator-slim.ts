import { logger, spawn } from '@react-native-harness/tools';
import { SIMULATOR_SLIM_LABELS } from './simulator-slim-seed.js';

const simulatorSlimLogger = logger.child('simulator-slim');

export { SIMULATOR_SLIM_LABELS } from './simulator-slim-seed.js';

/**
 * Harness has always left PosterBoard running when it slims a booted
 * simulator, and still does. simslim keeps it from starting at boot without
 * trouble, so it is only stopped by seeding the overrides before boot.
 */
const SEED_ONLY_LABELS: ReadonlySet<string> = new Set(['com.apple.PosterBoard']);

/**
 * The loudest log subsystems at idle; Harness reads none of them. The
 * simulator rejects a system-wide log level, but accepts one per subsystem.
 */
export const SIMULATOR_QUIET_LOG_SUBSYSTEMS = [
  'com.apple.locationd.Position',
  'com.apple.locationd.Utility',
  'com.apple.network',
  'com.apple.CFNetwork',
  'com.apple.icloudMCCKit',
] as const;

const DEFAULT_SLIM_PARALLELISM = 8;
// One `simctl spawn` was observed to take about 20s on a saturated runner.
const SIMCTL_SPAWN_TIMEOUT_MS = 60_000;

export type SimulatorSlimResult = {
  stopped: string[];
  /** Already disabled and not running, typically because the boot was seeded. */
  alreadyStopped: string[];
  quieted: string[];
  skipped: string[];
  /** True when the deadline passed before every call was made. */
  timedOut: boolean;
  durationMs: number;
};

type LaunchdState = {
  disabled: ReadonlySet<string>;
  running: ReadonlySet<string>;
};

const runInSimulator = async (
  udid: string,
  args: string[],
  signal?: AbortSignal
): Promise<string | null> => {
  try {
    const { stdout } = await spawn('xcrun', ['simctl', 'spawn', udid, ...args], {
      timeout: SIMCTL_SPAWN_TIMEOUT_MS,
      signal,
    });
    return stdout ?? '';
  } catch (error) {
    simulatorSlimLogger.debug('simctl spawn %o failed: %o', args, error);
    return null;
  }
};

/**
 * Reads `launchctl print-disabled` lines. Recent launchd prints
 * `"com.apple.x" => disabled`; older builds print `=> true`.
 */
export const parsePrintDisabled = (output: string): Set<string> => {
  const disabled = new Set<string>();
  for (const match of output.matchAll(/"([^"]+)"\s*=>\s*(disabled|true)\b/g)) {
    disabled.add(match[1]);
  }
  return disabled;
};

/** Labels of the jobs `launchctl list` shows with a PID, i.e. running. */
export const parseRunningLabels = (output: string): Set<string> => {
  const running = new Set<string>();
  for (const line of output.split('\n')) {
    const [pid, , label] = line.trim().split(/\s+/);
    if (label && /^\d+$/.test(pid)) {
      running.add(label);
    }
  }
  return running;
};

const readLaunchdState = async (
  udid: string,
  signal?: AbortSignal
): Promise<LaunchdState | null> => {
  const [printDisabled, list] = await Promise.all([
    runInSimulator(udid, ['launchctl', 'print-disabled', 'system'], signal),
    runInSimulator(udid, ['launchctl', 'list'], signal),
  ]);
  if (printDisabled === null || list === null) {
    return null;
  }
  return {
    disabled: parsePrintDisabled(printDisabled),
    running: parseRunningLabels(list),
  };
};

const forEachWithConcurrency = async <T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal
): Promise<void> => {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (next < items.length && !signal?.aborted) {
        await worker(items[next++]);
      }
    }
  );
  await Promise.all(lanes);
};

/**
 * Makes sure the services in {@link SIMULATOR_SLIM_LABELS} are stopped in a
 * booted simulator, and silences {@link SIMULATOR_QUIET_LOG_SUBSYSTEMS}. It
 * reads launchd's state first, so a simulator that booted from seeded
 * overrides (see `seedSimulatorSlim`) costs two reads. A service still
 * enabled is disabled, and one still running is booted out: disable alone
 * does not stop a running service. If the state cannot be read, every service
 * gets both. Never throws; failures are reported as skipped, and once
 * `signal` aborts no further calls are made.
 */
export const slimSimulator = async (
  udid: string,
  {
    parallelism = DEFAULT_SLIM_PARALLELISM,
    signal,
  }: { parallelism?: number; signal?: AbortSignal } = {}
): Promise<SimulatorSlimResult> => {
  const startedAt = Date.now();
  const result: SimulatorSlimResult = {
    stopped: [],
    alreadyStopped: [],
    quieted: [],
    skipped: [],
    timedOut: false,
    durationMs: 0,
  };
  const run = async (args: string[]) =>
    (await runInSimulator(udid, args, signal)) !== null;

  const state = await readLaunchdState(udid, signal);
  if (!state) {
    simulatorSlimLogger.debug(
      'could not read launchd state of %s; stopping every service',
      udid
    );
  }

  const tasks: Array<() => Promise<void>> = [];
  for (const label of SIMULATOR_SLIM_LABELS) {
    const disabled = state?.disabled.has(label) ?? false;
    const running = state?.running.has(label) ?? true;
    if (disabled && !running) {
      result.alreadyStopped.push(label);
      continue;
    }
    if (SEED_ONLY_LABELS.has(label)) {
      continue;
    }
    tasks.push(async () => {
      // `system/` prints a deprecation warning and resolves to the user domain.
      if (!disabled && !(await run(['launchctl', 'disable', `system/${label}`]))) {
        result.skipped.push(label);
        return;
      }
      if (running) {
        // Fails when the service is not running after all; disable still applies.
        await run(['launchctl', 'bootout', `system/${label}`]);
      }
      result.stopped.push(label);
    });
  }
  for (const subsystem of SIMULATOR_QUIET_LOG_SUBSYSTEMS) {
    tasks.push(async () => {
      const quieted = await run([
        'log',
        'config',
        '--subsystem',
        subsystem,
        '--mode',
        'level:off,persist:off',
      ]);
      (quieted ? result.quieted : result.skipped).push(subsystem);
    });
  }

  await forEachWithConcurrency(tasks, parallelism, (task) => task(), signal);

  result.timedOut = signal?.aborted ?? false;
  result.durationMs = Date.now() - startedAt;
  return result;
};
