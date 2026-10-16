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

    expect(collector.collect).toHaveBeenCalledWith('platform.ready');
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
});
