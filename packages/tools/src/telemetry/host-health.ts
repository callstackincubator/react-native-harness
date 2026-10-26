import os from 'node:os';
import path from 'node:path';
import { unrefTimer } from '../unref-timer.js';
import { diffCpuTimes, readCpuTimes } from './host-resources.js';
import type { ProcessUsageRow } from './process-snapshot.js';

/**
 * Load above this multiple of the core count means work is queueing. Only
 * used when idle CPU is unknown: load is a lagging 1-minute average that on
 * macOS also counts threads not using the CPU, so it stays high after the
 * host has calmed down.
 */
const SATURATED_LOAD_PER_CPU = 2;
/** Below this share of idle CPU, nothing is left for the run itself. */
const SATURATED_IDLE_PCT = 5;
/** Memory swapped out during startup that marks the host as starved. */
const STARVED_SWAPOUTS_MB = 256;
const HOST_HEALTH_WINDOW_MS = 1000;

export const isCI = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !!env.CI && env.CI !== 'false' && env.CI !== '0';

export type HostHealthSample = {
  load1: number;
  cpuCount: number;
  /** Null when the CPU counters did not advance over the window. */
  idlePct: number | null;
};

export type HostHealthVerdict = HostHealthSample & {
  saturated: boolean;
};

export const evaluateHostHealth = (
  sample: HostHealthSample
): HostHealthVerdict => ({
  ...sample,
  saturated:
    sample.idlePct !== null
      ? sample.idlePct < SATURATED_IDLE_PCT
      : sample.load1 > sample.cpuCount * SATURATED_LOAD_PER_CPU,
});

/**
 * Starts measuring host CPU at the call site and resolves with a verdict once
 * a short window has passed. Call it before anything heavy is started, so the
 * verdict describes load that was already on the host. It never blocks the
 * caller: only the returned promise waits for the window.
 */
export const checkHostHealth = (
  windowMs = HOST_HEALTH_WINDOW_MS
): Promise<HostHealthVerdict> => {
  const before = readCpuTimes();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(
        evaluateHostHealth({
          load1: os.loadavg()[0] ?? 0,
          cpuCount: os.availableParallelism(),
          idlePct: diffCpuTimes(before, readCpuTimes())?.idlePct ?? null,
        })
      );
    }, windowMs);
    unrefTimer(timer);
  });
};

const formatProcess = ({ command, cpu_pct }: ProcessUsageRow): string =>
  `${path.basename(command)} (${cpu_pct.toFixed(0)}% CPU)`;

export const formatSaturatedHostMessage = (
  verdict: HostHealthVerdict,
  topByCpu: readonly ProcessUsageRow[] = []
): string => {
  const idle =
    verdict.idlePct === null ? '' : `, ${verdict.idlePct.toFixed(0)}% idle`;
  const culprits =
    topByCpu.length > 0
      ? ` Busiest processes: ${topByCpu.slice(0, 5).map(formatProcess).join(', ')}.`
      : '';
  return (
    `The CI runner was already saturated before Harness started anything ` +
    `(load ${verdict.load1.toFixed(1)} on ${verdict.cpuCount} cores${idle}). ` +
    `Startup timeouts on this run are likely caused by the host, not the app.` +
    culprits
  );
};

const escapeAnnotationData = (value: string): string =>
  value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const escapeAnnotationProperty = (value: string): string =>
  escapeAnnotationData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * Formats a GitHub Actions workflow command that shows up as a warning
 * annotation on the run. Returns null outside GitHub Actions.
 */
export const formatGitHubWarning = (
  title: string,
  message: string,
  env: NodeJS.ProcessEnv = process.env
): string | null =>
  env.GITHUB_ACTIONS === 'true'
    ? `::warning title=${escapeAnnotationProperty(title)}::${escapeAnnotationData(message)}`
    : null;

export type HostPressure = {
  peakLoad1: number | null;
  /** Mean of the sampled idle CPU share, in percent. */
  meanIdlePct: number | null;
  minHostFreeMb: number | null;
  /** Memory swapped out while the pressure was observed, in MB. */
  swapoutsDeltaMb: number | null;
  cpuCount: number;
};

/**
 * True when the pressure observed during startup explains a timeout: the CPU
 * was almost never idle, or memory was swapped out. Peak load alone does not
 * count, because booting a simulator pushes it high on any small host.
 */
export const isHostStarved = (pressure: HostPressure): boolean =>
  (pressure.meanIdlePct !== null &&
    pressure.meanIdlePct < SATURATED_IDLE_PCT) ||
  (pressure.swapoutsDeltaMb !== null &&
    pressure.swapoutsDeltaMb >= STARVED_SWAPOUTS_MB);

export const formatHostPressure = (pressure: HostPressure): string => {
  const format = (value: number | null, unit: string, digits = 0) =>
    value === null ? 'n/a' : `${value.toFixed(digits)}${unit}`;
  return (
    `peak load ${format(pressure.peakLoad1, '', 1)} on ${pressure.cpuCount} cores, ` +
    `average idle ${format(pressure.meanIdlePct, '%')}, ` +
    `min free memory ${format(pressure.minHostFreeMb, ' MB')}, ` +
    `swapped out ${format(pressure.swapoutsDeltaMb, ' MB')}`
  );
};
