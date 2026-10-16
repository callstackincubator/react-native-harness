import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeRuntimeProbe } from '../node-runtime.js';
import { createProbeContext } from './helpers.js';

const histogram = vi.hoisted(() => ({
  enable: vi.fn(),
  disable: vi.fn(),
  reset: vi.fn(),
  percentile: vi.fn(),
  count: 0,
  max: 0,
}));

vi.mock('node:perf_hooks', () => ({
  monitorEventLoopDelay: () => histogram,
}));

describe('nodeRuntimeProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    histogram.count = 10;
    histogram.max = 270e6; // 270ms between ticks = 250ms of lag at a 20ms resolution
    histogram.percentile.mockImplementation((p: number) =>
      p === 50 ? 21e6 : 120e6
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('emits process memory and event loop lag gauges every interval', async () => {
    const ctx = createProbeContext();

    const stop = nodeRuntimeProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);

    const gauges = Object.fromEntries(
      ctx.diagnostics.flush().map((entry) => [entry.label, entry.value])
    );
    expect(Object.keys(gauges)).toEqual([
      'node.rss_mb',
      'node.heap_used_mb',
      'node.heap_total_mb',
      'node.external_mb',
      'node.event_loop.p50_ms',
      'node.event_loop.p99_ms',
      'node.event_loop.max_ms',
    ]);
    expect(gauges['node.rss_mb']).toBeGreaterThan(0);
    expect(gauges['node.event_loop.p50_ms']).toBeCloseTo(1);
    expect(gauges['node.event_loop.p99_ms']).toBeCloseTo(100);
    expect(gauges['node.event_loop.max_ms']).toBeCloseTo(250);

    await vi.advanceTimersByTimeAsync(5000);
    expect(histogram.reset).toHaveBeenCalledTimes(2);
    expect(ctx.diagnostics.flush().length).toBe(7);

    stop();
  });

  it('omits lag gauges while the histogram has no data', async () => {
    histogram.count = 0;
    const ctx = createProbeContext();

    const stop = nodeRuntimeProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);

    expect(
      ctx.diagnostics
        .flush()
        .filter((e) => e.label.startsWith('node.event_loop'))
    ).toEqual([]);
    stop();
  });

  it('disables the histogram and stops sampling when stopped', async () => {
    const ctx = createProbeContext();

    const stop = nodeRuntimeProbe.start(ctx);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    ctx.diagnostics.flush();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(histogram.disable).toHaveBeenCalled();
    expect(ctx.diagnostics.flush()).toEqual([]);
  });
});
