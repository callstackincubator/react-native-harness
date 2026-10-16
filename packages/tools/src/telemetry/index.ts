import { logger } from '../logger.js';
import { getEmitter } from '../events.js';
import type { LifecycleEvent, ProbeContext, TelemetryProbe } from './types.js';
import { runContextProbe } from './run-context.js';
import { hostResourcesProbe } from './host-resources.js';
import { nodeRuntimeProbe } from './node-runtime.js';
import { processSnapshotProbe } from './process-snapshot.js';
import {
  createPlatformCollectorProbe,
  type PlatformCollectorProbeOptions,
} from './platform-collector.js';

export type {
  LifecycleEvent,
  LifecyclePhase,
  ProbeContext,
  TelemetryCollector,
  TelemetryProbe,
} from './types.js';
export type { PlatformCollectorProbeOptions } from './platform-collector.js';

const telemetryLogger = logger.child('telemetry');

export const DEFAULT_SAMPLE_INTERVAL_MS = 5000;

export const createLifecycleEmitter = () => getEmitter<LifecycleEvent>();

export type DefaultProbeOptions = {
  /** Load, CPU split and memory pressure of the host. Default: on. */
  host?: boolean;
  /** Memory and event loop lag of the Harness process. Default: on. */
  node?: boolean;
  /** Process listings at lifecycle boundaries (macOS). Default: on. */
  snapshots?: boolean;
  /** Platform specific measurements. Omit to leave them out. */
  platform?: PlatformCollectorProbeOptions;
};

/** The one place that decides which probes make up a standard run. */
export const createDefaultProbes = (
  options: DefaultProbeOptions = {}
): TelemetryProbe[] => {
  const probes: TelemetryProbe[] = [runContextProbe];

  if (options.host ?? true) {
    probes.push(hostResourcesProbe);
  }
  if (options.node ?? true) {
    probes.push(nodeRuntimeProbe);
  }
  if (options.snapshots ?? true) {
    probes.push(processSnapshotProbe);
  }
  if (options.platform) {
    probes.push(createPlatformCollectorProbe(options.platform));
  }

  return probes;
};

// Upper bound on how long dispose() lets in-flight work finish when the
// caller has not already aborted it.
const DISPOSE_SETTLE_TIMEOUT_MS = 5000;

export type TelemetryRun = {
  /** Resolves once all lifecycle driven work started so far has finished. */
  settled(): Promise<void>;
  /**
   * Stops every probe. Safe to call more than once. In-flight work is only
   * waited for (bounded) if the context's signal has not been aborted: an
   * aborted run has no use for results that are still pending.
   */
  dispose(): Promise<void>;
};

const noopRun: TelemetryRun = {
  settled: async () => undefined,
  dispose: async () => undefined,
};

/**
 * Starts probes against the diagnostics sink. When diagnostics are disabled
 * nothing starts: no timers, no listeners, no spawned processes. A probe that
 * fails to start is skipped without affecting the others.
 */
export const startTelemetryProbes = (
  probes: readonly TelemetryProbe[],
  ctx: Omit<ProbeContext, 'track'>
): TelemetryRun => {
  if (!ctx.diagnostics.enabled || ctx.signal.aborted) {
    return noopRun;
  }

  const pending = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work);
    const forget = () => {
      pending.delete(work);
    };
    work.then(forget, forget);
    return work;
  };

  const stops: Array<{ name: string; stop: () => void | Promise<void> }> = [];
  for (const probe of probes) {
    try {
      stops.push({ name: probe.name, stop: probe.start({ ...ctx, track }) });
    } catch (error) {
      telemetryLogger.debug('probe %s failed to start: %s', probe.name, error);
    }
  }

  const settled = async () => {
    while (pending.size > 0) {
      await Promise.allSettled([...pending]);
    }
  };

  let disposed: Promise<void> | null = null;
  const dispose = () => {
    disposed ??= (async () => {
      for (const { name, stop } of stops) {
        try {
          await stop();
        } catch (error) {
          telemetryLogger.debug('probe %s failed to stop: %s', name, error);
        }
      }
      if (!ctx.signal.aborted) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, DISPOSE_SETTLE_TIMEOUT_MS);
        });
        try {
          await Promise.race([settled(), timeout]);
        } finally {
          clearTimeout(timer);
        }
      }
    })();
    return disposed;
  };

  return { settled, dispose };
};
