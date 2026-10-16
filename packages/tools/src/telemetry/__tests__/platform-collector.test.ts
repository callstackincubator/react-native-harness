import { describe, expect, it, vi } from 'vitest';
import { createPlatformCollectorProbe } from '../platform-collector.js';
import type { TelemetryCollector } from '../types.js';
import { createProbeContext, settle } from './helpers.js';

describe('platform collector probe', () => {
  it('emits numeric values as platform gauges and strings as mark attrs', async () => {
    const collector: TelemetryCollector = {
      collect: vi.fn().mockResolvedValue({
        'ios.simulator.guest_process_count': 312,
        'ios.simulator.runtime': 'iOS 26.4',
      }),
    };
    const ctx = createProbeContext();
    createPlatformCollectorProbe({ getCollector: () => collector }).start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'platform.ready' });
    await settle(ctx);

    expect(collector.collect).toHaveBeenCalledWith(
      'platform.ready',
      expect.any(AbortSignal)
    );
    const [gauge, mark] = ctx.diagnostics.flush();
    expect(gauge).toMatchObject({
      label: 'platform.ios.simulator.guest_process_count',
      kind: 'gauge',
      value: 312,
      attrs: { phase: 'platform.ready' },
    });
    expect(mark).toMatchObject({
      label: 'telemetry.platform',
      kind: 'mark',
      attrs: { phase: 'platform.ready', 'ios.simulator.runtime': 'iOS 26.4' },
    });
  });

  it('resolves the collector lazily, once, and only on collector phases', async () => {
    const collector: TelemetryCollector = {
      collect: vi.fn().mockResolvedValue({ a: 1 }),
    };
    const getCollector = vi.fn(() => collector);
    const ctx = createProbeContext();
    createPlatformCollectorProbe({ getCollector }).start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'metro.ready' });
    ctx.lifecycle.emit({ type: 'phase', phase: 'test-file.start' });
    await settle(ctx);
    expect(getCollector).not.toHaveBeenCalled();

    ctx.lifecycle.emit({ type: 'phase', phase: 'platform.ready' });
    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await settle(ctx);
    await settle(ctx);

    expect(getCollector).toHaveBeenCalledTimes(1);
    expect(collector.collect).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the platform has no collector', async () => {
    const ctx = createProbeContext();
    createPlatformCollectorProbe({ getCollector: () => undefined }).start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await settle(ctx);

    expect(ctx.diagnostics.flush()).toEqual([]);
  });

  it('survives a failing collector and disposes it when stopped', async () => {
    const collector: TelemetryCollector = {
      collect: vi.fn().mockRejectedValue(new Error('simctl down')),
      dispose: vi.fn(),
    };
    const ctx = createProbeContext();
    const stop = createPlatformCollectorProbe({
      getCollector: () => collector,
    }).start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'platform.ready' });
    await settle(ctx);
    expect(ctx.diagnostics.flush()).toEqual([]);

    await stop();
    expect(collector.dispose).toHaveBeenCalled();
  });

  it('aborts the signal handed to collect when stopped, and never collects afterwards', async () => {
    let received: AbortSignal | undefined;
    const collect = vi.fn(
      (_phase: string, signal: AbortSignal) =>
        new Promise<Record<string, number>>((resolve) => {
          received = signal;
          signal.addEventListener('abort', () => resolve({ a: 1 }));
        })
    );
    const collector: TelemetryCollector = { collect, dispose: vi.fn() };
    const ctx = createProbeContext();
    const stop = createPlatformCollectorProbe({
      getCollector: () => collector,
    }).start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'platform.ready' });
    ctx.lifecycle.emit({ type: 'phase', phase: 'dispose' });
    await Promise.resolve();
    expect(received?.aborted).toBe(false);

    await stop();
    await settle(ctx);

    expect(received?.aborted).toBe(true);
    // The queued dispose collection never ran, and the aborted one reported nothing.
    expect(collect).toHaveBeenCalledTimes(1);
    expect(ctx.diagnostics.flush()).toEqual([]);
  });

  it('aborts the collect signal when the context signal aborts', async () => {
    let received: AbortSignal | undefined;
    const collector: TelemetryCollector = {
      collect: vi.fn(async (_phase, signal) => {
        received = signal;
        return {};
      }),
    };
    const ctx = createProbeContext();
    createPlatformCollectorProbe({ getCollector: () => collector }).start(ctx);

    ctx.lifecycle.emit({ type: 'phase', phase: 'platform.ready' });
    await settle(ctx);
    ctx.controller.abort();

    expect(received?.aborted).toBe(true);
  });
});
