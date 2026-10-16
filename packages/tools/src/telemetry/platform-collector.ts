import type { DiagnosticAttrs } from '../diagnostics.js';
import type {
  LifecyclePhase,
  TelemetryCollector,
  TelemetryProbe,
} from './types.js';
import { createSerialQueue, onLifecyclePhases } from './probe-utils.js';

const COLLECTOR_PHASES: readonly LifecyclePhase[] = [
  'platform.ready',
  'app.ready',
  'dispose',
];

export type PlatformCollectorProbeOptions = {
  /**
   * Resolves the collector lazily: the platform runner usually does not exist
   * yet when probes start. Returns undefined when the platform has none.
   */
  getCollector: () => TelemetryCollector | undefined;
};

/**
 * Bridges platform-specific measurements into diagnostics. The platform
 * decides what to measure; this probe decides when (lifecycle phases) and
 * how it is recorded: numbers as `platform.<key>` gauges, strings as attrs of
 * a `telemetry.platform` mark.
 */
export const createPlatformCollectorProbe = ({
  getCollector,
}: PlatformCollectorProbeOptions): TelemetryProbe => ({
  name: 'platform-collector',
  start: (ctx) => {
    const { diagnostics } = ctx;
    const queue = createSerialQueue();
    const controller = new AbortController();
    const abort = () => controller.abort();
    ctx.signal.addEventListener('abort', abort, { once: true });
    let collector: TelemetryCollector | undefined;

    const stop = onLifecyclePhases(ctx, COLLECTOR_PHASES, ({ phase }) =>
      queue.run(async () => {
        collector ??= getCollector();
        if (!collector) {
          return;
        }

        const values = await collector.collect(phase, controller.signal);
        if (controller.signal.aborted) {
          return;
        }

        const strings: DiagnosticAttrs = {};
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === 'number') {
            diagnostics.gauge(`platform.${key}`, value, { phase });
          } else {
            strings[key] = value;
          }
        }

        if (Object.keys(strings).length > 0) {
          diagnostics.mark('telemetry.platform', { phase, ...strings });
        }
      })
    );

    return () => {
      stop();
      queue.close();
      controller.abort();
      ctx.signal.removeEventListener('abort', abort);
      collector?.dispose?.();
    };
  },
});
