import { logger, spawn } from '@react-native-harness/tools';
import * as simctl from './xcrun/simctl.js';
import { shouldSlimSimulatorOnCi } from './startup-strategy.js';

const simulatorSlimLogger = logger.child('simulator-slim');

/**
 * Simulator services a Harness test run never uses. Right after boot they
 * keep several cores busy (photo analysis alone takes about three cores for
 * over a minute) and, taken together, add enough memory pressure to starve a
 * 3-core, 7 GB CI runner.
 *
 * Kept on purpose, because Harness or the app depends on them: launchd_sim,
 * SpringBoard, backboardd, runningboardd, PosterBoard, logd, diagnosticd,
 * ReportCrash, tccd, testmanagerd, installd, lsd, securityd, trustd, cfprefsd,
 * SimRenderServer and locationd.
 *
 * Labels were taken from the iOS 26.4 runtime (23E254a). `launchctl
 * disable` accepts labels a runtime does not have, so those cost a call but
 * do no harm.
 */
export const SIMULATOR_SLIM_LABELS = [
  // Photo and media analysis.
  'com.apple.mediaanalysisd',
  'com.apple.mediaanalysisd.service',
  'com.apple.photoanalysisd',
  'com.apple.cloudphotod',
  // Home screen widgets; chronod launches every widget extension.
  'com.apple.chronod',
  // Personal data, sync and iCloud.
  'com.apple.remindd',
  'com.apple.calaccessd',
  'com.apple.contactsd',
  'com.apple.contacts.postersyncd',
  'com.apple.apsd',
  'com.apple.cloudd',
  'com.apple.bird',
  'com.apple.appleaccountd',
  'com.apple.icloudmailagent',
  'com.apple.dataaccess.dataaccessd',
  'com.apple.itunescloudd',
  'com.apple.mediastream.mstreamd',
  'com.apple.familycircled',
  'com.apple.familynotification',
  'com.apple.nanoprefsyncd.2',
  'com.apple.nanonewscd',
  // Health and fitness.
  'com.apple.healthd',
  'com.apple.healthappd',
  'com.apple.fitnessintelligenced',
  'com.apple.finhealthd',
  // Intelligence, Siri and suggestions.
  'com.apple.generativeexperiencesd',
  'com.apple.intelligenceplatformd',
  'com.apple.intelligencecontextd',
  'com.apple.intelligenceflowd',
  'com.apple.intelligencetasksd',
  'com.apple.callintelligenced',
  'com.apple.knowledgeconstructiond',
  'com.apple.biomed',
  'com.apple.biomesyncd',
  'com.apple.suggestd',
  'com.apple.assistantd',
  'com.apple.assistant_cdmd',
  'com.apple.assistant_service',
  'com.apple.siri.context.service',
  'com.apple.siriactionsd',
  'com.apple.siriinferenced',
  'com.apple.siriknowledged',
  'com.apple.sirittsd',
  // Search indexing.
  'com.apple.searchd',
  'com.apple.spotlightknowledged',
  'com.apple.spotlightknowledged.updater',
  'com.apple.corespotlightservice',
  // Other apps' background daemons.
  'com.apple.appstored',
  'com.apple.jetpackassetd',
  'com.apple.gamed',
  'com.apple.weatherd',
  'com.apple.newsd',
  'com.apple.routined',
  'com.apple.Maps.mapssyncd',
  'com.apple.ScreenTimeAgent',
  'com.apple.UsageTrackingAgent',
  'com.apple.shazamd',
] as const;

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
// Booting, waiting for boot and slimming normally take 1-5 minutes on a small
// runner. Past this, the step gives up and leaves the rest to Harness.
const DEFAULT_PREPARE_TIMEOUT_MS = 8 * 60_000;

export type SimulatorSlimResult = {
  stopped: string[];
  quieted: string[];
  skipped: string[];
  /** True when the deadline passed before every call was made. */
  timedOut: boolean;
  durationMs: number;
};

const spawnInSimulator = async (
  udid: string,
  args: string[],
  signal?: AbortSignal
): Promise<boolean> => {
  try {
    await spawn('xcrun', ['simctl', 'spawn', udid, ...args], {
      timeout: SIMCTL_SPAWN_TIMEOUT_MS,
      signal,
    });
    return true;
  } catch (error) {
    simulatorSlimLogger.debug('simctl spawn %o failed: %o', args, error);
    return false;
  }
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
 * Stops the simulator services in {@link SIMULATOR_SLIM_LABELS} and silences
 * {@link SIMULATOR_QUIET_LOG_SUBSYSTEMS}. Every service needs both `disable`
 * and `bootout`: disable alone does not stop on-demand launches later in the
 * boot. The state lives in CoreSimulator's memory, so it has to be applied
 * after every boot. Never throws; failures are reported as skipped, and
 * once `signal` aborts no further calls are made.
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
    quieted: [],
    skipped: [],
    timedOut: false,
    durationMs: 0,
  };
  const run = (args: string[]) => spawnInSimulator(udid, args, signal);

  // `system/` prints a deprecation warning and resolves to the user domain.
  const tasks: Array<() => Promise<void>> = [
    ...SIMULATOR_SLIM_LABELS.map((label) => async () => {
      if (!(await run(['launchctl', 'disable', `system/${label}`]))) {
        result.skipped.push(label);
        return;
      }
      // Fails when the service is not running yet; disable still applies.
      await run(['launchctl', 'bootout', `system/${label}`]);
      result.stopped.push(label);
    }),
    ...SIMULATOR_QUIET_LOG_SUBSYSTEMS.map((subsystem) => async () => {
      const quieted = await run([
        'log',
        'config',
        '--subsystem',
        subsystem,
        '--mode',
        'level:off,persist:off',
      ]);
      (quieted ? result.quieted : result.skipped).push(subsystem);
    }),
  ];

  await forEachWithConcurrency(tasks, parallelism, (task) => task(), signal);

  result.timedOut = signal?.aborted ?? false;
  result.durationMs = Date.now() - startedAt;
  return result;
};

const CI_SIMULATOR_SLIM_MODES = ['auto', 'true', 'false'] as const;
export type CiSimulatorSlimMode = (typeof CI_SIMULATOR_SLIM_MODES)[number];

/** Normalizes the action input; returns null for an unknown value. */
export const parseCiSimulatorSlimMode = (
  value: string | undefined
): CiSimulatorSlimMode | null => {
  const mode = (value ?? '').trim().toLowerCase() || 'auto';
  return (CI_SIMULATOR_SLIM_MODES as readonly string[]).includes(mode)
    ? (mode as CiSimulatorSlimMode)
    : null;
};

/**
 * `auto` slims only on GitHub-hosted runners with 3 cores or less than 8 GB.
 * Self-hosted machines are skipped because the stopped services stay stopped
 * for that simulator until CoreSimulator restarts.
 */
export const resolveCiSimulatorSlim = (
  mode: CiSimulatorSlimMode,
  { githubHosted }: { githubHosted: boolean }
): boolean => {
  switch (mode) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      return githubHosted && shouldSlimSimulatorOnCi();
  }
};

export type PrepareCiSimulatorResult =
  | { status: 'not-found' }
  | { status: 'prepared'; udid: string; bootedNow: boolean; slim: SimulatorSlimResult };

/**
 * Boots the simulator a runner uses and slims it before Harness starts, so
 * the work stays outside Harness's startup timeout. Harness then picks up the
 * booted simulator as it is. Throws if booting does not finish before the
 * deadline; slimming stops early instead.
 */
export const prepareCiSimulator = async ({
  name,
  systemVersion,
  parallelism,
  timeoutMs = DEFAULT_PREPARE_TIMEOUT_MS,
}: {
  name: string;
  systemVersion: string;
  parallelism?: number;
  timeoutMs?: number;
}): Promise<PrepareCiSimulatorResult> => {
  const signal = AbortSignal.timeout(timeoutMs);
  const udid = await simctl.getSimulatorId(name, systemVersion);
  if (!udid) {
    return { status: 'not-found' };
  }

  const status = await simctl.getSimulatorStatus(udid);
  const bootedNow = !(
    simctl.isBootedSimulatorStatus(status) ||
    simctl.isBootingSimulatorStatus(status)
  );
  if (bootedNow) {
    await simctl.bootSimulator(udid, signal);
  }
  // A simulator booted earlier in the job may still be starting up, and
  // calls into it fail until it has.
  await simctl.waitForBoot(udid, signal);

  return {
    status: 'prepared',
    udid,
    bootedNow,
    slim: await slimSimulator(udid, { parallelism, signal }),
  };
};
