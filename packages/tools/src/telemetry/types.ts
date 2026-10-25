import type { DiagnosticAttrs, Diagnostics } from '../diagnostics.js';
import type { EventEmitter } from '../events.js';

/**
 * Points in a run's life that probes can react to. Session code emits these;
 * probes only listen. They are the boundaries at which heavier measurements
 * (process listings, guest process counts) are allowed to run.
 */
export type LifecyclePhase =
  | 'session.created'
  | 'run.start'
  | 'run.end'
  | 'metro.ready'
  | 'platform.ready'
  | 'app.ready'
  | 'test-file.start'
  | 'test-file.end'
  | 'dispose';

export type LifecycleEvent = {
  type: 'phase';
  phase: LifecyclePhase;
  attrs?: DiagnosticAttrs;
};

export type ProbeContext = {
  /** The single sink every probe writes to. */
  diagnostics: Diagnostics;
  /** Aborts when telemetry is shutting down; probes must stop all work. */
  signal: AbortSignal;
  lifecycle: EventEmitter<LifecycleEvent>;
  sampleIntervalMs: number;
  /**
   * Registers in-flight asynchronous work so that the owner can wait for it
   * (for example a `dispose` snapshot that must finish before teardown).
   */
  track: <T>(work: Promise<T>) => Promise<T>;
};

export type TelemetryProbe = {
  name: string;
  /** Starts the probe and returns the function that stops it. */
  start(ctx: ProbeContext): () => void | Promise<void>;
};

/**
 * Platform-specific measurements, supplied by a platform runner and driven by
 * the generic `platform-collector` probe at lifecycle phases. Numeric values
 * become gauges named `platform.<key>`; strings become attrs of a mark.
 */
export type TelemetryCollector = {
  /**
   * `signal` aborts when telemetry stops; collectors must pass it to whatever
   * they spawn so teardown never waits on a measurement nobody will read.
   */
  collect(
    phase: LifecyclePhase,
    signal: AbortSignal
  ): Promise<Record<string, number | string>>;
  dispose?(): void;
};
