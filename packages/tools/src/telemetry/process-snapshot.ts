import { spawn } from '../spawn.js';
import type { TelemetryProbe } from './types.js';
import { createSerialQueue, onLifecyclePhases } from './probe-utils.js';

const TOP_PROCESS_LIMIT = 40;
const TOP_TIMEOUT_MS = 60_000;
// Generous: on a saturated host even `ps` was observed to take over 10s.
const PS_TIMEOUT_MS = 30_000;
const PROCESS_USAGE_LIMIT = 10;

export type ProcessMemoryRow = { pid: number; mem_mb: number; command: string };

export type ProcessSnapshot = {
  totalProcesses: number | null;
  top: ProcessMemoryRow[];
};

const UNIT_TO_MB: Record<string, number> = {
  B: 1 / (1024 * 1024),
  K: 1 / 1024,
  M: 1,
  G: 1024,
  T: 1024 * 1024,
};

/**
 * Parses the output of `top -l 1 -o mem -stats pid,mem,command`. `top` prints
 * memory as a number with a unit suffix and an optional trend marker (`4803M`,
 * `720K+`). Returns rows in the order `top` listed them (largest first).
 */
export const parseTopOutput = (output: string): ProcessSnapshot => {
  const totalProcesses = /^Processes:\s+(\d+) total/m.exec(output)?.[1];
  const top: ProcessMemoryRow[] = [];

  let inTable = false;
  for (const line of output.split('\n')) {
    if (!inTable) {
      inTable = /^\s*PID\s+MEM\s+COMMAND/.test(line);
      continue;
    }

    const match = /^\s*(\d+)\s+(\d+(?:\.\d+)?)([BKMGT])[+-]?\s+(.*?)\s*$/.exec(
      line
    );
    if (match) {
      top.push({
        pid: Number(match[1]),
        mem_mb:
          Math.round(
            Number(match[2]) * (UNIT_TO_MB[match[3] as string] ?? 0) * 10
          ) / 10,
        command: match[4] as string,
      });
    }
  }

  if (totalProcesses === undefined && top.length === 0) {
    throw new Error('unrecognised top output');
  }

  return {
    totalProcesses:
      totalProcesses === undefined ? null : Number(totalProcesses),
    top: top.slice(0, TOP_PROCESS_LIMIT),
  };
};

export type ProcessUsageRow = {
  pid: number;
  cpu_pct: number;
  rss_mb: number;
  command: string;
};

/**
 * Parses `ps -A -o pid=,pcpu=,rss=,comm=` output (RSS in KB). Rows that do not
 * match are skipped; `ps` itself appears in its own listing and is dropped.
 */
export const parsePsOutput = (output: string): ProcessUsageRow[] => {
  const rows: ProcessUsageRow[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+(?:[.,]\d+)?)\s+(\d+)\s+(.+?)\s*$/.exec(
      line
    );
    if (!match || /(^|\/)ps$/.test(match[4] as string)) {
      continue;
    }
    rows.push({
      pid: Number(match[1]),
      cpu_pct: Number((match[2] as string).replace(',', '.')),
      rss_mb: Math.round((Number(match[3]) / 1024) * 10) / 10,
      command: match[4] as string,
    });
  }
  return rows;
};

export type ProcessUsageSnapshot = {
  topByCpu: ProcessUsageRow[];
  topByRss: ProcessUsageRow[];
};

/** Reduces a process listing to the heaviest processes by CPU and by RSS. */
export const summarizeProcessUsage = (
  rows: readonly ProcessUsageRow[],
  limit = PROCESS_USAGE_LIMIT
): ProcessUsageSnapshot => ({
  topByCpu: [...rows].sort((a, b) => b.cpu_pct - a.cpu_pct).slice(0, limit),
  topByRss: [...rows].sort((a, b) => b.rss_mb - a.rss_mb).slice(0, limit),
});

/**
 * One `ps` listing of every process with its CPU share and resident memory.
 * `ps` is cheap compared to `top` and works the same on macOS and Linux.
 */
export const readProcessUsage = async (
  signal: AbortSignal
): Promise<ProcessUsageSnapshot> => {
  const { stdout } = await spawn(
    'ps',
    ['-A', '-o', 'pid=,pcpu=,rss=,comm='],
    { signal, timeout: PS_TIMEOUT_MS, env: { LC_ALL: 'C' } }
  );
  return summarizeProcessUsage(parsePsOutput(stdout));
};

/**
 * Records, once at session start, which processes were already using the CPU
 * and memory before Harness started anything. When a run later starves, this
 * names what else was running on the host.
 */
const startSessionStartSnapshot = (
  ctx: Parameters<TelemetryProbe['start']>[0]
): (() => void) => {
  const { diagnostics, signal } = ctx;
  return onLifecyclePhases(ctx, ['session.created'], () => {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      return;
    }
    return (async () => {
      try {
        const snapshot = await readProcessUsage(signal);
        if (signal.aborted) {
          return;
        }
        diagnostics.mark('telemetry.session_start_processes', {
          top_by_cpu: JSON.stringify(snapshot.topByCpu),
          top_by_rss: JSON.stringify(snapshot.topByRss),
        });
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        diagnostics.mark('telemetry.session_start_processes', {
          error: String(error).slice(0, 200),
        });
      }
    })();
  });
};

/**
 * On macOS, takes one process listing at selected lifecycle boundaries. It
 * answers "what was eating the memory" after the fact. `top` is expensive, so
 * it runs only on lifecycle phases, never on a timer.
 */
export const processSnapshotProbe: TelemetryProbe = {
  name: 'process-snapshot',
  start: (ctx) => {
    const stopSessionStartSnapshot = startSessionStartSnapshot(ctx);
    if (process.platform !== 'darwin') {
      return stopSessionStartSnapshot;
    }

    const { diagnostics, signal } = ctx;
    const queue = createSerialQueue();
    // `app.ready` fires after every app relaunch, which can be once per test
    // file; only the first one is a milestone worth the cost of `top`.
    let appReadySeen = false;

    const stop = onLifecyclePhases(
      ctx,
      ['platform.ready', 'app.ready', 'dispose'],
      ({ phase }) => {
        if (phase === 'app.ready') {
          if (appReadySeen) {
            return;
          }
          appReadySeen = true;
        }

        return queue.run(async () => {
          if (signal.aborted) {
            return;
          }
          try {
            const { stdout } = await spawn(
              'top',
              [
                '-l',
                '1',
                '-o',
                'mem',
                '-stats',
                'pid,mem,command',
                '-n',
                String(TOP_PROCESS_LIMIT),
              ],
              { signal, timeout: TOP_TIMEOUT_MS }
            );
            const snapshot = parseTopOutput(stdout);

            diagnostics.mark('telemetry.process_snapshot', {
              phase,
              total_processes: snapshot.totalProcesses ?? undefined,
              top: JSON.stringify(snapshot.top),
            });
            if (snapshot.totalProcesses !== null) {
              diagnostics.gauge('host.process_count', snapshot.totalProcesses, {
                phase,
              });
            }
          } catch (error) {
            diagnostics.mark('telemetry.process_snapshot', {
              phase,
              error: String(error).slice(0, 200),
            });
          }
        });
      }
    );

    return () => {
      stopSessionStartSnapshot();
      stop();
      queue.close();
    };
  },
};
