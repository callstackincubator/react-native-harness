import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  diffCpuTimes,
  hostResourcesProbe,
  parseProcMeminfo,
  parseVmStat,
} from '../host-resources.js';
import { spawn } from '../../spawn.js';
import { createProbeContext, setPlatform } from './helpers.js';

vi.mock('../../spawn.js', () => ({ spawn: vi.fn() }));

// Captured from a real macOS 26 machine under load.
const VM_STAT_FIXTURE = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    86397.
Pages active:                                 504004.
Pages inactive:                               502069.
Pages speculative:                              1676.
Pages throttled:                                   0.
Pages wired down:                             273327.
Pages purgeable:                                7910.
"Translation faults":                    18231809846.
Pages copy-on-write:                       662114877.
Pages zero filled:                        6415585096.
Pages reactivated:                        3744162215.
Pages purged:                              372034680.
File-backed pages:                            343914.
Anonymous pages:                              663835.
Pages stored in compressor:                  2682589.
Pages occupied by compressor:                 938001.
Decompressions:                           4366165984.
Compressions:                             4681060812.
Pageins:                                   537224043.
Pageouts:                                    9405118.
Swapins:                                    23243815.
Swapouts:                                   27729919.
`;

const pagesToMb = (pages: number, pageSize = 16384) =>
  (pages * pageSize) / (1024 * 1024);

describe('parseVmStat', () => {
  it('derives MB values using the page size from the header', () => {
    expect(parseVmStat(VM_STAT_FIXTURE)).toEqual({
      freeMb: pagesToMb(86397),
      anonymousMb: pagesToMb(663835),
      wiredMb: pagesToMb(273327),
      compressedMb: pagesToMb(938001),
      demandMb: pagesToMb(663835 + 273327 + 938001),
      swapoutsMb: pagesToMb(27729919),
      compressionsMb: pagesToMb(4681060812),
    });
  });

  it('honours a 4 KiB page size', () => {
    const output = VM_STAT_FIXTURE.replace('16384', '4096');
    expect(parseVmStat(output)?.freeMb).toBe(pagesToMb(86397, 4096));
  });

  it('returns null for unrecognised or incomplete output', () => {
    expect(parseVmStat('')).toBeNull();
    expect(parseVmStat('vm_stat: command not found')).toBeNull();
    expect(
      parseVmStat(
        'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 1.'
      )
    ).toBeNull();
  });
});

describe('parseProcMeminfo', () => {
  it('reads free and available memory in MB', () => {
    const content =
      'MemTotal:       16384000 kB\nMemFree:         2048 kB\nMemAvailable:    4096 kB\n';
    expect(parseProcMeminfo(content)).toEqual({ freeMb: 2, availableMb: 4 });
  });

  it('tolerates a missing MemAvailable and returns null without MemFree', () => {
    expect(parseProcMeminfo('MemFree: 1024 kB\n')).toEqual({
      freeMb: 1,
      availableMb: null,
    });
    expect(parseProcMeminfo('nope')).toBeNull();
  });
});

describe('diffCpuTimes', () => {
  it('splits the interval into user, sys and idle percentages', () => {
    const usage = diffCpuTimes(
      { user: 100, sys: 50, idle: 850 },
      { user: 200, sys: 100, idle: 1700 }
    );
    expect(usage?.userPct).toBeCloseTo((100 / 1000) * 100);
    expect(usage?.sysPct).toBeCloseTo(5);
    expect(usage?.idlePct).toBeCloseTo(85);
  });

  it('returns null when no time elapsed', () => {
    const times = { user: 1, sys: 1, idle: 1 };
    expect(diffCpuTimes(times, times)).toBeNull();
  });
});

describe('hostResourcesProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const gaugeLabels = (ctx: ReturnType<typeof createProbeContext>) =>
    ctx.diagnostics.flush().map((entry) => entry.label);

  it('samples load, cpu and vm_stat memory on darwin, on every interval', async () => {
    setPlatform('darwin');
    vi.mocked(spawn).mockResolvedValue({ stdout: VM_STAT_FIXTURE } as never);
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);

    // The first sample has no CPU baseline to diff against, so no cpu gauges.
    const first = gaugeLabels(ctx);
    expect(first).toEqual([
      'host.load1',
      'host.mem.free',
      'host.mem.anonymous',
      'host.mem.wired',
      'host.mem.compressed',
      'host.mem.demand',
      'host.mem.swapouts',
      'host.mem.compressions',
    ]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('vm_stat');

    stop();
  });

  it('emits memory values as MB gauges with a demand metric', async () => {
    setPlatform('darwin');
    vi.mocked(spawn).mockResolvedValue({ stdout: VM_STAT_FIXTURE } as never);
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);

    const gauges = Object.fromEntries(
      ctx.diagnostics.flush().map((entry) => [entry.label, entry.value])
    );
    expect(gauges['host.mem.compressed']).toBe(pagesToMb(938001));
    expect(gauges['host.mem.demand']).toBe(
      (gauges['host.mem.anonymous'] as number) +
        (gauges['host.mem.wired'] as number) +
        (gauges['host.mem.compressed'] as number)
    );
    stop();
  });

  it('skips a tick while the previous sample is still running', async () => {
    setPlatform('darwin');
    let resolveSpawn: (value: unknown) => void = () => undefined;
    vi.mocked(spawn).mockImplementation(
      () => new Promise((resolve) => (resolveSpawn = resolve)) as never
    );
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spawn).toHaveBeenCalledTimes(1);

    resolveSpawn({ stdout: VM_STAT_FIXTURE });
    await vi.advanceTimersByTimeAsync(5000);
    expect(spawn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('emits cpu split gauges from the second sample on', async () => {
    setPlatform('win32');
    const cpu = (user: number, sys: number, idle: number) =>
      [{ times: { user, nice: 0, sys, idle, irq: 0 } }] as never;
    vi.spyOn(os, 'cpus')
      .mockReturnValueOnce(cpu(100, 50, 850))
      .mockReturnValueOnce(cpu(200, 100, 1700));
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(gaugeLabels(ctx)).not.toContain('host.cpu.user_pct');

    await vi.advanceTimersByTimeAsync(5000);
    const gauges = Object.fromEntries(
      ctx.diagnostics.flush().map((entry) => [entry.label, entry.value])
    );
    expect(gauges['host.cpu.user_pct']).toBeCloseTo(10);
    expect(gauges['host.cpu.sys_pct']).toBeCloseTo(5);
    expect(gauges['host.cpu.idle_pct']).toBeCloseTo(85);
    stop();
  });

  it('pauses between runs and resumes with a fresh cpu baseline', async () => {
    setPlatform('win32');
    const cpu = (user: number, sys: number, idle: number) =>
      [{ times: { user, nice: 0, sys, idle, irq: 0 } }] as never;
    vi.spyOn(os, 'cpus')
      .mockReturnValueOnce(cpu(100, 50, 850))
      .mockReturnValueOnce(cpu(300, 100, 1000))
      .mockReturnValueOnce(cpu(10_000, 5_000, 90_000));
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);
    ctx.lifecycle.emit({ type: 'phase', phase: 'run.end' });
    ctx.diagnostics.flush();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.diagnostics.flush()).toEqual([]);

    ctx.lifecycle.emit({ type: 'phase', phase: 'run.start' });
    await vi.advanceTimersByTimeAsync(0);
    // First sample after the pause: no cpu gauges (the gap was idle time).
    expect(gaugeLabels(ctx)).toEqual(['host.load1', 'host.mem.free']);

    stop();
  });

  it('resumes sampling on dispose, so teardown is still observed', async () => {
    setPlatform('win32');
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);
    ctx.lifecycle.emit({ type: 'phase', phase: 'run.end' });
    ctx.diagnostics.flush();

    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await vi.advanceTimersByTimeAsync(0);

    expect(gaugeLabels(ctx)).toContain('host.load1');
    stop();
  });

  it('stops sampling after the returned stop function is called', async () => {
    setPlatform('darwin');
    vi.mocked(spawn).mockResolvedValue({ stdout: VM_STAT_FIXTURE } as never);
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    ctx.diagnostics.flush();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(ctx.diagnostics.flush()).toEqual([]);
  });

  it('stops sampling when the signal aborts', async () => {
    setPlatform('darwin');
    vi.mocked(spawn).mockResolvedValue({ stdout: VM_STAT_FIXTURE } as never);
    const ctx = createProbeContext();

    hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);
    ctx.controller.abort();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('falls back to os.freemem and never spawns on other platforms', async () => {
    setPlatform('win32');
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);

    expect(spawn).not.toHaveBeenCalled();
    expect(gaugeLabels(ctx)).toEqual(['host.load1', 'host.mem.free']);
    stop();
  });

  it('falls back to os.freemem when vm_stat fails', async () => {
    setPlatform('darwin');
    vi.mocked(spawn).mockRejectedValue(new Error('spawn vm_stat ENOENT'));
    const ctx = createProbeContext();

    const stop = hostResourcesProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);

    expect(gaugeLabels(ctx)).toEqual(['host.load1', 'host.mem.free']);
    stop();
  });
});
