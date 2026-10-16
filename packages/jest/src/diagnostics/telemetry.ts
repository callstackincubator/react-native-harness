import { randomUUID } from 'node:crypto';
import {
  createDefaultProbes,
  createLifecycleEmitter,
  DEFAULT_SAMPLE_INTERVAL_MS,
  startTelemetryProbes,
  type Diagnostics,
  type DiagnosticAttrs,
  type LifecyclePhase,
} from '@react-native-harness/tools';
import {
  resolveDiagnosticsOptions,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import type { HarnessPlatformRunner } from '@react-native-harness/platforms';
import { createDiagnosticsAppender } from './report.js';

export type SessionTelemetry = {
  /** Identifies the session; names the incremental `.jsonl` log. */
  readonly sessionId: string;
  /** Session code emits phases here; probes listen. */
  readonly lifecycle: ReturnType<typeof createLifecycleEmitter>;
  /** Emits a lifecycle phase. */
  phase(phase: LifecyclePhase, attrs?: DiagnosticAttrs): void;
  /** Makes the platform runner available to the platform collector probe. */
  attachPlatform(platform: HarnessPlatformRunner): void;
  /** Resolves once lifecycle driven collection started so far has finished. */
  settled(): Promise<void>;
  /** Stops probes and the incremental log. Safe to call more than once. */
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
    settled: run.settled,
    dispose: () => {
      disposed ??= (async () => {
        try {
          abortController.abort();
          await run.dispose();
        } finally {
          appender.dispose();
        }
      })();
      return disposed;
    },
  };
};
