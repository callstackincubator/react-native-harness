import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiagnostics } from '../../diagnostics.js';
import { createDefaultProbes, startTelemetryProbes } from '../index.js';
import { spawn } from '../../spawn.js';
import type { TelemetryProbe } from '../types.js';
import { createProbeContext } from './helpers.js';

vi.mock('../../spawn.js', () => ({ spawn: vi.fn() }));

describe('startTelemetryProbes', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts nothing when diagnostics are disabled', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { signal, lifecycle } = createProbeContext();
    const start = vi.fn(() => () => undefined);

    const run = startTelemetryProbes(
      [
        { name: 'spy', start },
        ...createDefaultProbes({ platform: { getCollector: () => undefined } }),
      ],
      {
        diagnostics: createDiagnostics({ enabled: false }),
        signal,
        lifecycle,
        sampleIntervalMs: 5000,
      }
    );
    lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await run.settled();
    await run.dispose();

    expect(start).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts every probe and stops them all on dispose, once', async () => {
    const stopA = vi.fn();
    const stopB = vi.fn().mockResolvedValue(undefined);
    const probes: TelemetryProbe[] = [
      { name: 'a', start: () => stopA },
      { name: 'b', start: () => stopB },
    ];
    const ctx = createProbeContext();

    const run = startTelemetryProbes(probes, ctx);
    await run.dispose();
    await run.dispose();

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
  });

  it('isolates probes that fail to start or to stop', async () => {
    const goodStop = vi.fn();
    const probes: TelemetryProbe[] = [
      {
        name: 'broken-start',
        start: () => {
          throw new Error('nope');
        },
      },
      {
        name: 'broken-stop',
        start: () => () => {
          throw new Error('nope');
        },
      },
      { name: 'good', start: () => goodStop },
    ];
    const ctx = createProbeContext();

    const run = startTelemetryProbes(probes, ctx);
    await expect(run.dispose()).resolves.toBeUndefined();

    expect(goodStop).toHaveBeenCalled();
  });

  it('exposes in-flight tracked work through settled()', async () => {
    vi.useFakeTimers();
    let finished = false;
    const probe: TelemetryProbe = {
      name: 'slow',
      start: (ctx) => {
        void ctx.track(
          new Promise<void>((resolve) =>
            setTimeout(() => {
              finished = true;
              resolve();
            }, 10)
          )
        );
        return () => undefined;
      },
    };
    const ctx = createProbeContext();

    const run = startTelemetryProbes([probe], ctx);
    expect(finished).toBe(false);
    const settled = run.settled();
    await vi.advanceTimersByTimeAsync(10);
    await settled;

    expect(finished).toBe(true);
  });

  const slowProbe = (durationMs: number): TelemetryProbe => ({
    name: 'slow',
    start: (ctx) => {
      void ctx.track(
        new Promise<void>((resolve) => setTimeout(resolve, durationMs))
      );
      return () => undefined;
    },
  });

  it('dispose() does not wait for work that was already aborted', async () => {
    vi.useFakeTimers();
    const ctx = createProbeContext();
    const run = startTelemetryProbes([slowProbe(4_000)], ctx);

    ctx.controller.abort();
    let disposed = false;
    void run.dispose().then(() => (disposed = true));
    await vi.advanceTimersByTimeAsync(0);

    expect(disposed).toBe(true);
  });

  it('dispose() bounds how long it waits for work that was not aborted', async () => {
    vi.useFakeTimers();
    const ctx = createProbeContext();
    const run = startTelemetryProbes([slowProbe(600_000)], ctx);

    let disposed = false;
    void run.dispose().then(() => (disposed = true));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(disposed).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(disposed).toBe(true);
  });

  it('does not start probes for an already aborted signal', () => {
    const start = vi.fn(() => () => undefined);
    const ctx = createProbeContext();
    const { controller } = ctx;
    controller.abort();

    startTelemetryProbes([{ name: 'x', start }], ctx);

    expect(start).not.toHaveBeenCalled();
  });
});

describe('createDefaultProbes', () => {
  const names = (options?: Parameters<typeof createDefaultProbes>[0]) =>
    createDefaultProbes(options).map((probe) => probe.name);

  it('enables the generic probes by default and leaves the platform one out', () => {
    expect(names()).toEqual([
      'run-context',
      'host-resources',
      'node-runtime',
      'process-snapshot',
    ]);
  });

  it('honours per-probe switches and adds the platform collector on request', () => {
    expect(
      names({
        host: false,
        node: false,
        snapshots: false,
        platform: { getCollector: () => undefined },
      })
    ).toEqual(['run-context', 'platform-collector']);
  });
});
