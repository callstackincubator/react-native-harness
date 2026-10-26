import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
  logger,
  createDefaultProbes,
  createLifecycleEmitter,
  DEFAULT_SAMPLE_INTERVAL_MS,
  startTelemetryProbes,
  type Diagnostics,
  type DiagnosticAttrs,
  type LifecyclePhase,
  type HostPressure,
} from '@react-native-harness/tools';
import {
  resolveDiagnosticsOptions,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import type { HarnessPlatformRunner } from '@react-native-harness/platforms';
import { appendToTraceFile, createDiagnosticsAppender } from './report.js';

const telemetryLogger = logger.child('diagnostics');

export type SessionTelemetry = {
  /** Identifies the session; names the incremental `.jsonl` log. */
  readonly sessionId: string;
  /** Session code emits phases here; probes listen. */
  readonly lifecycle: ReturnType<typeof createLifecycleEmitter>;
  /** Emits a lifecycle phase. */
  phase(phase: LifecyclePhase, attrs?: DiagnosticAttrs): void;
  /** Makes the platform runner available to the platform collector probe. */
  attachPlatform(platform: HarnessPlatformRunner): void;
  /** Records the run that is current, so teardown data can join its trace. */
  trackRun(runId: string): void;
  /**
   * Host pressure observed by the host-resources probe so far: peak load,
   * mean idle CPU, lowest free memory and memory swapped out since the first
   * sample. Null
   * when no host sample was taken (diagnostics or the host probe are off).
   */
  hostPressure(): HostPressure | null;
  /** Resolves once lifecycle driven collection started so far has finished. */
  settled(): Promise<void>;
  /**
   * Stops probes and the incremental log. Entries recorded since the last
   * run's report was written (the end-of-run snapshot, teardown spans) are
   * added to that run's trace. Safe to call more than once.
   */
  dispose(): Promise<void>;
};

/**
 * The single composition point for run telemetry: it wires the incremental
 * log and the probes to the one diagnostics sink. Session code only emits
 * lifecycle phases; it never calls a probe. Everything is a no-op, with no
 * timers, listeners or spawned processes, when diagnostics are disabled.
 */
export const startSessionTelemetry = ({
  diagnostics,
  config,
  projectRoot,
}: {
  diagnostics: Diagnostics;
  config: Pick<HarnessConfig, 'diagnostics'>;
  projectRoot: string;
}): SessionTelemetry => {
  const sessionId = randomUUID();
  const lifecycle = createLifecycleEmitter();
  const abortController = new AbortController();
  const options = resolveDiagnosticsOptions(config);

  let platform: HarnessPlatformRunner | undefined;
  let lastRunId: string | undefined;

  const appender = createDiagnosticsAppender(diagnostics, {
    projectRoot,
    id: sessionId,
  });

  const run = startTelemetryProbes(
    createDefaultProbes({
      host: options.probes.host,
      node: options.probes.node,
      snapshots: options.probes.snapshots,
      platform: options.probes.platform
        ? { getCollector: () => platform?.createTelemetryCollector?.() }
        : undefined,
    }),
    {
      diagnostics,
      signal: abortController.signal,
      lifecycle,
      sampleIntervalMs: options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
    }
  );

  // Running aggregates rather than stored samples: a watch-mode session can
  // live for hours, and only the extremes are needed.
  let peakLoad1: number | null = null;
  let idlePctSum = 0;
  let idlePctSamples = 0;
  let minHostFreeMb: number | null = null;
  let firstSwapoutsMb: number | null = null;
  let lastSwapoutsMb: number | null = null;
  const unsubscribePressure = diagnostics.subscribe(
    ({ kind, label, value }) => {
      if (kind !== 'gauge' || typeof value !== 'number') {
        return;
      }
      if (label === 'host.load1') {
        peakLoad1 = Math.max(peakLoad1 ?? value, value);
      } else if (label === 'host.cpu.idle_pct') {
        idlePctSum += value;
        idlePctSamples += 1;
      } else if (label === 'host.mem.free') {
        minHostFreeMb = Math.min(minHostFreeMb ?? value, value);
      } else if (label === 'host.mem.swapouts') {
        firstSwapoutsMb ??= value;
        lastSwapoutsMb = value;
      }
    },
    { replay: true }
  );

  const hostPressure = (): HostPressure | null =>
    peakLoad1 === null && minHostFreeMb === null && lastSwapoutsMb === null
      ? null
      : {
          peakLoad1,
          meanIdlePct: idlePctSamples > 0 ? idlePctSum / idlePctSamples : null,
          minHostFreeMb,
          swapoutsDeltaMb:
            firstSwapoutsMb !== null && lastSwapoutsMb !== null
              ? lastSwapoutsMb - firstSwapoutsMb
              : null,
          cpuCount: os.availableParallelism(),
        };

  const phase = (name: LifecyclePhase, attrs?: DiagnosticAttrs) => {
    if (!diagnostics.enabled) {
      return;
    }
    lifecycle.emit({ type: 'phase', phase: name, attrs });
  };

  let disposed: Promise<void> | null = null;

  return {
    sessionId,
    lifecycle,
    phase,
    attachPlatform: (runner) => {
      platform = runner;
    },
    trackRun: (runId) => {
      lastRunId = runId;
    },
    hostPressure,
    settled: run.settled,
    dispose: () => {
      disposed ??= (async () => {
        unsubscribePressure();
        try {
          abortController.abort();
          await run.dispose();
          if (diagnostics.enabled && lastRunId) {
            const leftover = diagnostics.flush();
            if (leftover.length > 0) {
              await appendToTraceFile(leftover, {
                projectRoot,
                runId: lastRunId,
              });
            }
          }
        } catch (error) {
          telemetryLogger.debug(
            'failed to finalize diagnostics trace: %s',
            error
          );
        } finally {
          await appender.dispose();
        }
      })();
      return disposed;
    },
  };
};
