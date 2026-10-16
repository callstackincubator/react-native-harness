import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTopOutput, processSnapshotProbe } from '../process-snapshot.js';
import { spawn } from '../../spawn.js';
import { createProbeContext, setPlatform, settle } from './helpers.js';

vi.mock('../../spawn.js', () => ({ spawn: vi.fn() }));

// Captured from `top -l 1 -o mem -stats pid,mem,command -n 8` on macOS 26.
const TOP_FIXTURE = `Processes: 937 total, 4 running, 933 sleeping, 7907 threads 
2026/10/16 08:41:16
Load Avg: 8.81, 5.21, 4.67 
CPU usage: 23.55% user, 22.0% sys, 54.44% idle 
SharedLibs: 750M resident, 109M data, 105M linkedit.
MemRegions: 703996 total, 9356M resident, 90M private, 3058M shared.
PhysMem: 34G used (4423M wired, 14G compressor), 1288M unused.
VM: 428T vsize, 6144M framework vsize, 23243815(0) swapins, 27729919(0) swapouts.
Networks: packets: 390438705/1106G in, 191447031/913G out.
Disks: 834043493/11T read, 526855368/8667G written.

PID    MEM   COMMAND         
33711  4803M qemu-system-aarc
44281  1966M Codex (Renderer)
98945  1497M+ Claude Helper (R
424    648M- WindowServer    
501    2G    big-process
77     512K  launchd
`;

describe('parseTopOutput', () => {
  it('parses the process total and memory rows in MB', () => {
    expect(parseTopOutput(TOP_FIXTURE)).toEqual({
      totalProcesses: 937,
      top: [
        { pid: 33711, mem_mb: 4803, command: 'qemu-system-aarc' },
        { pid: 44281, mem_mb: 1966, command: 'Codex (Renderer)' },
        { pid: 98945, mem_mb: 1497, command: 'Claude Helper (R' },
        { pid: 424, mem_mb: 648, command: 'WindowServer' },
        { pid: 501, mem_mb: 2048, command: 'big-process' },
        { pid: 77, mem_mb: 0.5, command: 'launchd' },
      ],
    });
  });

  it('keeps at most the top 40 rows', () => {
    const rows = Array.from(
      { length: 60 },
      (_, i) => `${i + 1}  ${100 - i}M  proc${i}`
    );
    const output = `Processes: 60 total\n\nPID MEM COMMAND\n${rows.join(
      '\n'
    )}\n`;

    expect(parseTopOutput(output).top).toHaveLength(40);
  });

  it('throws on output it does not recognise', () => {
    expect(() => parseTopOutput('command not found')).toThrow();
  });
});

describe('processSnapshotProbe', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('takes no snapshot until a lifecycle phase arrives', () => {
    setPlatform('darwin');
    const ctx = createProbeContext();

    processSnapshotProbe.start(ctx);

    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['platform.ready', 'app.ready', 'dispose'] as const)(
    'emits a snapshot mark and process count on %s',
    async (phase) => {
      setPlatform('darwin');
      vi.mocked(spawn).mockResolvedValue({ stdout: TOP_FIXTURE } as never);
      const ctx = createProbeContext();
      processSnapshotProbe.start(ctx);

      ctx.lifecycle.emit({ type: 'phase', phase });
      await settle(ctx);

      expect(spawn).toHaveBeenCalledWith(
        'top',
        ['-l', '1', '-o', 'mem', '-stats', 'pid,mem,command', '-n', '40'],
        expect.objectContaining({ signal: ctx.signal })
      );
      const entries = ctx.diagnostics.flush();
      const mark = entries.find(
        (e) => e.label === 'telemetry.process_snapshot'
      );
      expect(mark?.kind).toBe('mark');
      expect(mark?.attrs).toMatchObject({ phase, total_processes: 937 });
      expect(JSON.parse(mark?.attrs?.top as string)).toHaveLength(6);
      expect(
        entries.find((e) => e.label === 'host.process_count')
      ).toMatchObject({
        kind: 'gauge',
        value: 937,
        attrs: { phase },
      });
    }
  );

  it('ignores phases that are not snapshot boundaries', async () => {
    setPlatform('darwin');
    const ctx = createProbeContext();
    processSnapshotProbe.start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'test-file.start' });
    ctx.lifecycle.emit({ type: 'phase', phase: 'metro.ready' });
    await settle(ctx);

    expect(spawn).not.toHaveBeenCalled();
  });

  it('runs back to back phases one after another', async () => {
    vi.useFakeTimers();
    setPlatform('darwin');
    let active = 0;
    let maxActive = 0;
    vi.mocked(spawn).mockImplementation((async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      active -= 1;
      return { stdout: TOP_FIXTURE };
    }) as never);
    const ctx = createProbeContext();
    processSnapshotProbe.start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'app.ready' });
    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await vi.advanceTimersByTimeAsync(20_000);
    await settle(ctx);

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('snapshots only the first app.ready, not every relaunch', async () => {
    setPlatform('darwin');
    vi.mocked(spawn).mockResolvedValue({ stdout: TOP_FIXTURE } as never);
    const ctx = createProbeContext();
    processSnapshotProbe.start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'app.ready' });
    await settle(ctx);
    ctx.lifecycle.emit({ type: 'phase', phase: 'app.ready' });
    ctx.lifecycle.emit({ type: 'phase', phase: 'app.ready' });
    await settle(ctx);
    expect(spawn).toHaveBeenCalledTimes(1);

    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await settle(ctx);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('skips queued snapshots once stopped or aborted, without error marks', async () => {
    vi.useFakeTimers();
    setPlatform('darwin');
    vi.mocked(spawn).mockImplementation(
      (() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ stdout: TOP_FIXTURE }), 1_000)
        )) as never
    );
    const ctx = createProbeContext();
    const stop = processSnapshotProbe.start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'platform.ready' });
    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle(ctx);

    // The running job finishes; the queued one never starts.
    expect(spawn).toHaveBeenCalledTimes(1);

    const ctx2 = createProbeContext();
    processSnapshotProbe.start(ctx2);
    ctx2.lifecycle.emit({ type: 'phase', phase: 'platform.ready' });
    ctx2.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    vi.mocked(spawn).mockClear();
    ctx2.controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle(ctx2);

    expect(spawn).toHaveBeenCalledTimes(0);
    expect(
      ctx2.diagnostics.flush().filter((e) => e.attrs?.error !== undefined)
    ).toEqual([]);
  });

  it('records an error mark instead of throwing when top fails', async () => {
    setPlatform('darwin');
    vi.mocked(spawn).mockRejectedValue(new Error('top exploded'));
    const ctx = createProbeContext();
    processSnapshotProbe.start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await settle(ctx);

    const [mark] = ctx.diagnostics.flush();
    expect(mark?.label).toBe('telemetry.process_snapshot');
    expect(mark?.attrs?.error).toContain('top exploded');
  });

  it('does nothing outside darwin', async () => {
    setPlatform('linux');
    const ctx = createProbeContext();
    const stop = processSnapshotProbe.start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await settle(ctx);

    expect(spawn).not.toHaveBeenCalled();
    expect(ctx.diagnostics.flush()).toEqual([]);
    stop();
  });

  it('stops listening once stopped', async () => {
    setPlatform('darwin');
    const ctx = createProbeContext();
    const stop = processSnapshotProbe.start(ctx);
    stop();

    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await settle(ctx);

    expect(spawn).not.toHaveBeenCalled();
  });
});
