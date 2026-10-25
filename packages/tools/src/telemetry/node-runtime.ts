import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { TelemetryProbe } from './types.js';
import { startSampler } from './probe-utils.js';

const BYTES_PER_MB = 1024 * 1024;
const NS_PER_MS = 1e6;
// The histogram records the full interval between timer ticks, so an idle loop
// reads as the resolution itself. Subtract it to report actual lag.
const RESOLUTION_MS = 20;

const toLagMs = (nanoseconds: number): number =>
  Math.max(0, nanoseconds / NS_PER_MS - RESOLUTION_MS);

/**
 * Samples the Harness (Node) process: memory and event loop lag. Event loop
 * lag is the early warning that the host is too busy for Harness itself to
 * schedule work, and the histogram is reset after every sample so each point
 * describes only its own interval.
 */
export const nodeRuntimeProbe: TelemetryProbe = {
  name: 'node-runtime',
  start: (ctx) => {
    const { diagnostics } = ctx;
    const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    histogram.enable();

    const stopSampling = startSampler(ctx, (_signal, { afterPause }) => {
      if (afterPause) {
        histogram.reset();
      }

      const memory = process.memoryUsage();
      diagnostics.gauge(
        'node.rss_mb',
        memory.rss / BYTES_PER_MB,
        undefined,
        'MB'
      );
      diagnostics.gauge(
        'node.heap_used_mb',
        memory.heapUsed / BYTES_PER_MB,
        undefined,
        'MB'
      );
      diagnostics.gauge(
        'node.heap_total_mb',
        memory.heapTotal / BYTES_PER_MB,
        undefined,
        'MB'
      );
      diagnostics.gauge(
        'node.external_mb',
        memory.external / BYTES_PER_MB,
        undefined,
        'MB'
      );

      // An empty histogram reports NaN percentiles; skip until it has data.
      if (histogram.count > 0) {
        diagnostics.gauge(
          'node.event_loop.p50_ms',
          toLagMs(histogram.percentile(50)),
          undefined,
          'ms'
        );
        diagnostics.gauge(
          'node.event_loop.p99_ms',
          toLagMs(histogram.percentile(99)),
          undefined,
          'ms'
        );
        diagnostics.gauge(
          'node.event_loop.max_ms',
          toLagMs(histogram.max),
          undefined,
          'ms'
        );
      }
      histogram.reset();
    });

    return () => {
      stopSampling();
      histogram.disable();
    };
  },
};
