import { spawn } from '../spawn.js';
import type { TelemetryProbe } from './types.js';
import { createSerialQueue, onLifecyclePhases } from './probe-utils.js';

const TOP_PROCESS_LIMIT = 40;
const TOP_TIMEOUT_MS = 60_000;

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

/**
 * On macOS, takes one process listing at selected lifecycle boundaries. It
 * answers "what was eating the memory" after the fact. `top` is expensive, so
 * it runs only on lifecycle phases, never on a timer.
 */
export const processSnapshotProbe: TelemetryProbe = {
  name: 'process-snapshot',
  start: (ctx) => {
    if (process.platform !== 'darwin') {
      return () => undefined;
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
      stop();
      queue.close();
    };
  },
};
