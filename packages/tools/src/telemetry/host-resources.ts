import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from '../spawn.js';
import type { Diagnostics } from '../diagnostics.js';
import type { TelemetryProbe } from './types.js';
import { startSampler } from './probe-utils.js';

const BYTES_PER_MB = 1024 * 1024;
const VM_STAT_TIMEOUT_MS = 10_000;

export type CpuTimes = { user: number; sys: number; idle: number };

export const readCpuTimes = (
  cpus: readonly os.CpuInfo[] = os.cpus()
): CpuTimes =>
  cpus.reduce<CpuTimes>(
    (total, { times }) => ({
      user: total.user + times.user + times.nice,
      sys: total.sys + times.sys + times.irq,
      idle: total.idle + times.idle,
    }),
    { user: 0, sys: 0, idle: 0 }
  );

/** CPU usage split over the interval between two `readCpuTimes` readings. */
export const diffCpuTimes = (
  previous: CpuTimes,
  current: CpuTimes
): { userPct: number; sysPct: number; idlePct: number } | null => {
  const user = current.user - previous.user;
  const sys = current.sys - previous.sys;
  const idle = current.idle - previous.idle;
  const total = user + sys + idle;

  if (total <= 0) {
    return null;
  }

  return {
    userPct: (user / total) * 100,
    sysPct: (sys / total) * 100,
    idlePct: (idle / total) * 100,
  };
};

export type VmStatMemory = {
  freeMb: number;
  anonymousMb: number;
  wiredMb: number;
  compressedMb: number;
  /**
   * Memory that cannot be reclaimed without compressing or swapping:
   * anonymous + wired + compressor-occupied pages. Free memory on macOS is
   * almost always near zero because the OS fills it with file cache, so
   * `free` alone cannot tell a healthy machine from a starved one; demand
   * compared against physical memory can.
   */
  demandMb: number;
  /** Cumulative since boot, converted from pages to MB. */
  swapoutsMb: number;
  /** Cumulative since boot, converted from pages to MB. */
  compressionsMb: number;
};

/** Parses `vm_stat` output. Returns null if it is not recognisable. */
export const parseVmStat = (output: string): VmStatMemory | null => {
  const pageSize = /page size of (\d+) bytes/.exec(output)?.[1];
  if (!pageSize) {
    return null;
  }

  const pages = new Map<string, number>();
  for (const line of output.split('\n')) {
    const match = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/.exec(line.trim());
    if (match) {
      pages.set(match[1] as string, Number(match[2]));
    }
  }

  const toMb = (key: string): number | null => {
    const count = pages.get(key);
    return count === undefined
      ? null
      : (count * Number(pageSize)) / BYTES_PER_MB;
  };

  const freeMb = toMb('Pages free');
  const anonymousMb = toMb('Anonymous pages');
  const wiredMb = toMb('Pages wired down');
  const compressedMb = toMb('Pages occupied by compressor');
  const swapoutsMb = toMb('Swapouts');
  const compressionsMb = toMb('Compressions');

  if (
    freeMb === null ||
    anonymousMb === null ||
    wiredMb === null ||
    compressedMb === null ||
    swapoutsMb === null ||
    compressionsMb === null
  ) {
    return null;
  }

  return {
    freeMb,
    anonymousMb,
    wiredMb,
    compressedMb,
    demandMb: anonymousMb + wiredMb + compressedMb,
    swapoutsMb,
    compressionsMb,
  };
};

/** Extracts free and available memory (MB) from `/proc/meminfo` content. */
export const parseProcMeminfo = (
  content: string
): { freeMb: number; availableMb: number | null } | null => {
  const kb = (key: string): number | null => {
    const match = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(content);
    return match ? Number(match[1]) / 1024 : null;
  };

  const freeMb = kb('MemFree');
  return freeMb === null ? null : { freeMb, availableMb: kb('MemAvailable') };
};

const sampleDarwinMemory = async (
  diagnostics: Diagnostics,
  signal: AbortSignal
): Promise<void> => {
  const { stdout } = await spawn('vm_stat', [], {
    signal,
    timeout: VM_STAT_TIMEOUT_MS,
  });
  const memory = parseVmStat(stdout);
  if (!memory || signal.aborted) {
    return;
  }

  diagnostics.gauge('host.mem.free', memory.freeMb, undefined, 'MB');
  diagnostics.gauge('host.mem.anonymous', memory.anonymousMb, undefined, 'MB');
  diagnostics.gauge('host.mem.wired', memory.wiredMb, undefined, 'MB');
  diagnostics.gauge(
    'host.mem.compressed',
    memory.compressedMb,
    undefined,
    'MB'
  );
  diagnostics.gauge('host.mem.demand', memory.demandMb, undefined, 'MB');
  diagnostics.gauge('host.mem.swapouts', memory.swapoutsMb, undefined, 'MB');
  diagnostics.gauge(
    'host.mem.compressions',
    memory.compressionsMb,
    undefined,
    'MB'
  );
};

const sampleLinuxMemory = async (diagnostics: Diagnostics): Promise<void> => {
  const parsed = parseProcMeminfo(await fs.readFile('/proc/meminfo', 'utf-8'));
  if (!parsed) {
    diagnostics.gauge(
      'host.mem.free',
      os.freemem() / BYTES_PER_MB,
      undefined,
      'MB'
    );
    return;
  }

  diagnostics.gauge('host.mem.free', parsed.freeMb, undefined, 'MB');
  if (parsed.availableMb !== null) {
    diagnostics.gauge(
      'host.mem.available',
      parsed.availableMb,
      undefined,
      'MB'
    );
  }
};

const sampleMemory = async (
  diagnostics: Diagnostics,
  signal: AbortSignal
): Promise<void> => {
  try {
    if (process.platform === 'darwin') {
      await sampleDarwinMemory(diagnostics, signal);
      return;
    }
    if (process.platform === 'linux') {
      await sampleLinuxMemory(diagnostics);
      return;
    }
  } catch {
    if (signal.aborted) {
      return;
    }
  }

  // Portable fallback, also used when the platform specific source failed.
  diagnostics.gauge(
    'host.mem.free',
    os.freemem() / BYTES_PER_MB,
    undefined,
    'MB'
  );
};

/**
 * Samples host-wide resource pressure. Only cheap sources are used on the
 * timer (`os.loadavg`, `os.cpus` deltas and, on macOS, one `vm_stat` spawn per
 * sample): measuring must not add to the load it is trying to observe.
 */
export const hostResourcesProbe: TelemetryProbe = {
  name: 'host-resources',
  start: (ctx) => {
    const { diagnostics } = ctx;
    let previousCpu: CpuTimes | null = null;

    return startSampler(ctx, async (signal, { afterPause }) => {
      if (afterPause) {
        // The interval since the last sample was idle time; do not blend it in.
        previousCpu = null;
      }

      diagnostics.gauge('host.load1', os.loadavg()[0] ?? 0, undefined, 'load');

      const currentCpu = readCpuTimes();
      const usage = previousCpu && diffCpuTimes(previousCpu, currentCpu);
      previousCpu = currentCpu;
      if (usage) {
        diagnostics.gauge('host.cpu.user_pct', usage.userPct, undefined, '%');
        diagnostics.gauge('host.cpu.sys_pct', usage.sysPct, undefined, '%');
        diagnostics.gauge('host.cpu.idle_pct', usage.idlePct, undefined, '%');
      }

      await sampleMemory(diagnostics, signal);
    });
  },
};
