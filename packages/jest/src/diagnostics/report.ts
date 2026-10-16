import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DiagnosticEntry, Diagnostics } from '@react-native-harness/tools';
import { getHarnessRootPath, logger } from '@react-native-harness/tools';

const reportLogger = logger.child('diagnostics');

type TraceEvent = {
  name: string;
  ph: 'X' | 'i' | 'C';
  ts: number;
  dur?: number;
  s?: 'g';
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
};

const TRACE_PID = 1;
const TRACE_TID = 1;

export const toTraceEvent = (entry: DiagnosticEntry): TraceEvent => {
  if (entry.kind === 'gauge') {
    // Counter events become graphed tracks in Perfetto / chrome://tracing,
    // one per distinct name, so each gauge label is its own series.
    return {
      name: entry.label,
      ph: 'C',
      ts: entry.startTime * 1000,
      pid: TRACE_PID,
      tid: TRACE_TID,
      args: { [entry.label]: entry.value ?? 0 },
    };
  }

  if (entry.kind === 'mark') {
    return {
      name: entry.label,
      ph: 'i',
      s: 'g',
      ts: entry.startTime * 1000,
      pid: TRACE_PID,
      tid: TRACE_TID,
      args: entry.attrs,
    };
  }

  return {
    name: entry.label,
    ph: 'X',
    ts: entry.startTime * 1000,
    dur: entry.duration * 1000,
    pid: TRACE_PID,
    tid: TRACE_TID,
    args: entry.attrs,
  };
};

export const writeTraceFile = async (
  entries: DiagnosticEntry[],
  options: { projectRoot: string; runId: string }
): Promise<string> => {
  const dir = getDiagnosticsDir(options.projectRoot);
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${options.runId}.json`);
  const trace = { traceEvents: entries.map(toTraceEvent) };

  await fs.writeFile(filePath, JSON.stringify(trace), 'utf-8');

  return filePath;
};

const getDiagnosticsDir = (projectRoot: string): string =>
  path.join(getHarnessRootPath(projectRoot), 'diagnostics');

export type DiagnosticsAppender = {
  readonly filePath: string;
  /** Synchronously writes everything buffered so far. */
  flush(): void;
  /** Flushes, then stops the timer and removes every process listener. */
  dispose(): void;
};

const APPENDED_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * Persists diagnostics entries as they are recorded, one JSON object per line
 * in `.harness/diagnostics/<id>.jsonl`. The final trace is only written when a
 * run finishes, so a job that is cancelled or killed mid-run (the case where
 * the data matters most) would otherwise leave nothing behind.
 *
 * Writes are batched (every `flushIntervalMs` or `maxBufferedEntries`) and
 * synchronous, so they also work from `exit` and signal handlers. A signal is
 * re-raised after flushing when nothing else is listening for it, so
 * persistence never changes how the process terminates.
 */
export const createDiagnosticsAppender = (
  diagnostics: Diagnostics,
  options: {
    projectRoot: string;
    id: string;
    flushIntervalMs?: number;
    maxBufferedEntries?: number;
  }
): DiagnosticsAppender => {
  const filePath = path.join(
    getDiagnosticsDir(options.projectRoot),
    `${options.id}.jsonl`
  );

  if (!diagnostics.enabled) {
    return { filePath, flush: () => undefined, dispose: () => undefined };
  }

  const maxBufferedEntries = options.maxBufferedEntries ?? 100;
  let buffer: string[] = [];
  let directoryReady = false;

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }

    const lines = buffer;
    buffer = [];
    try {
      if (!directoryReady) {
        fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
        directoryReady = true;
      }
      fsSync.appendFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
    } catch (error) {
      reportLogger.debug('failed to append diagnostics: %s', error);
    }
  };

  const unsubscribe = diagnostics.subscribe((entry) => {
    buffer.push(JSON.stringify(entry));
    if (buffer.length >= maxBufferedEntries) {
      flush();
    }
  });

  const timer = setInterval(flush, options.flushIntervalMs ?? 2000);
  timer.unref();

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of APPENDED_SIGNALS) {
    const handler = () => {
      flush();
      if (process.listenerCount(signal) === 1) {
        // Ours is the only handler: restore the default behaviour (terminate).
        process.off(signal, handler);
        process.kill(process.pid, signal);
      }
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.on('exit', flush);

  const dispose = () => {
    unsubscribe();
    clearInterval(timer);
    flush();
    process.off('exit', flush);
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    signalHandlers.clear();
  };

  return { filePath, flush, dispose };
};

export type RunKpis = {
  bootWaitMs: number | null;
  timeToReadyMs: number | null;
  peakHostCompressedMb: number | null;
  peakLoad1: number | null;
  minHostFreeMb: number | null;
  /** Memory swapped out during the run, in MB. */
  swapoutsDelta: number | null;
  maxEventLoopLagMs: number | null;
  testFileCount: number;
  result: 'passed' | 'failed' | null;
};

const maxOf = (values: number[]): number | null =>
  values.length > 0 ? Math.max(...values) : null;

const minOf = (values: number[]): number | null =>
  values.length > 0 ? Math.min(...values) : null;

/**
 * Reduces a run's entries to the handful of numbers worth comparing between
 * runs. Anything that cannot be derived from the entries is null, never a
 * guess, so a missing probe shows up as "n/a" rather than as a misleading 0.
 */
export const summarizeRunKpis = (entries: DiagnosticEntry[]): RunKpis => {
  const gaugeValues = (label: string): number[] =>
    entries
      .filter((entry) => entry.kind === 'gauge' && entry.label === label)
      .map((entry) => entry.value)
      .filter((value): value is number => typeof value === 'number');

  const spans = (label: string): DiagnosticEntry[] =>
    entries.filter((entry) => entry.kind === 'span' && entry.label === label);

  const bootSpans = entries.filter(
    (entry) => entry.kind === 'span' && entry.label.endsWith('.waitForBoot')
  );

  const sessionStart = spans('session.config.load')[0]?.startTime;
  const firstReady = spans('app.ready.total').find(
    (entry) => entry.status === 'ok'
  );

  const swapouts = gaugeValues('host.mem.swapouts');
  const runStatus = spans('run.total')[0]?.attrs?.status;

  return {
    bootWaitMs:
      bootSpans.length > 0
        ? bootSpans.reduce((total, entry) => total + entry.duration, 0)
        : null,
    timeToReadyMs:
      sessionStart !== undefined && firstReady
        ? firstReady.startTime + firstReady.duration - sessionStart
        : null,
    peakHostCompressedMb: maxOf(gaugeValues('host.mem.compressed')),
    peakLoad1: maxOf(gaugeValues('host.load1')),
    minHostFreeMb: minOf(gaugeValues('host.mem.free')),
    swapoutsDelta:
      swapouts.length >= 2
        ? (swapouts[swapouts.length - 1] as number) - (swapouts[0] as number)
        : null,
    maxEventLoopLagMs: maxOf(gaugeValues('node.event_loop.max_ms')),
    testFileCount: spans('run.file').length,
    result:
      runStatus === 'passed' || runStatus === 'failed' ? runStatus : null,
  };
};

export const writeSummaryFile = async (
  kpis: RunKpis,
  options: { projectRoot: string; runId: string; sessionId?: string }
): Promise<string> => {
  const dir = getDiagnosticsDir(options.projectRoot);
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${options.runId}.summary.json`);
  const summary = {
    runId: options.runId,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...kpis,
  };
  await fs.writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8');

  return filePath;
};

const formatNumber = (value: number | null, unit: string, digits = 0) =>
  value === null ? 'n/a' : `${value.toFixed(digits)}${unit}`;

const formatKpiDuration = (ms: number | null) =>
  ms === null ? 'n/a' : formatDuration(ms);

/** The KPIs as label/value pairs, in display order. */
export const formatRunKpis = (kpis: RunKpis): Array<[string, string]> => [
  ['Result', kpis.result ?? 'n/a'],
  ['Test files', String(kpis.testFileCount)],
  ['Boot wait', formatKpiDuration(kpis.bootWaitMs)],
  ['Time to ready', formatKpiDuration(kpis.timeToReadyMs)],
  ['Peak host load (1m)', formatNumber(kpis.peakLoad1, '', 1)],
  ['Peak compressed memory', formatNumber(kpis.peakHostCompressedMb, ' MB')],
  ['Min free memory', formatNumber(kpis.minHostFreeMb, ' MB')],
  ['Swapped out during run', formatNumber(kpis.swapoutsDelta, ' MB')],
  ['Max event loop lag', formatNumber(kpis.maxEventLoopLagMs, ' ms')],
];

/**
 * Appends the KPIs as a markdown table to the GitHub Actions job summary when
 * running there. Best effort: a failure here must never fail the run.
 */
export const appendStepSummary = async (
  kpis: RunKpis,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const rows = formatRunKpis(kpis).map(([label, value]) => `| ${label} | ${value} |`);
  const markdown = [
    '### Harness run KPIs',
    '',
    '| KPI | Value |',
    '| --- | --- |',
    ...rows,
    '',
    '',
  ].join('\n');

  try {
    await fs.appendFile(summaryPath, markdown, 'utf-8');
  } catch (error) {
    reportLogger.debug('failed to write GitHub step summary: %s', error);
  }
};

const formatDuration = (ms: number): string => {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
};

const getNamespace = (label: string): string => label.split('.')[0] ?? label;

type LabelStats = {
  label: string;
  count: number;
  totalMs: number;
  maxMs: number;
};

export const printSummary = (
  entries: DiagnosticEntry[],
  log: (line: string) => void
): void => {
  if (entries.length === 0) {
    return;
  }

  const statsByLabel = new Map<string, LabelStats>();
  for (const entry of entries) {
    // Gauges are samples, not timings; they are summarised as KPIs below.
    if (entry.kind === 'gauge') {
      continue;
    }
    const existing = statsByLabel.get(entry.label);
    if (existing) {
      existing.count += 1;
      existing.totalMs += entry.duration;
      existing.maxMs = Math.max(existing.maxMs, entry.duration);
    } else {
      statsByLabel.set(entry.label, {
        label: entry.label,
        count: 1,
        totalMs: entry.duration,
        maxMs: entry.duration,
      });
    }
  }

  const byNamespace = new Map<string, LabelStats[]>();
  for (const stats of statsByLabel.values()) {
    const namespace = getNamespace(stats.label);
    const group = byNamespace.get(namespace);
    if (group) {
      group.push(stats);
    } else {
      byNamespace.set(namespace, [stats]);
    }
  }

  log('Diagnostics summary:');
  const sortedNamespaces = [...byNamespace.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );
  for (const [namespace, group] of sortedNamespaces) {
    log(`  ${namespace}`);
    group.sort((a, b) => b.totalMs - a.totalMs);
    for (const stats of group) {
      log(
        `    ${stats.label}: count=${stats.count} total=${formatDuration(stats.totalMs)} max=${formatDuration(stats.maxMs)}`
      );
    }
  }
  log('  KPIs');
  for (const [label, value] of formatRunKpis(summarizeRunKpis(entries))) {
    log(`    ${label}: ${value}`);
  }
};
