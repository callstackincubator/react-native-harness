import fs from 'node:fs/promises';
import path from 'node:path';
import type { DiagnosticEntry } from '@react-native-harness/tools';
import { getHarnessRootPath } from '@react-native-harness/tools';

type TraceEvent = {
  name: string;
  ph: 'X' | 'i';
  ts: number;
  dur?: number;
  s?: 'g';
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
};

const TRACE_PID = 1;
const TRACE_TID = 1;

const toTraceEvent = (entry: DiagnosticEntry): TraceEvent => {
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
  const dir = path.join(getHarnessRootPath(options.projectRoot), 'diagnostics');
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${options.runId}.json`);
  const trace = { traceEvents: entries.map(toTraceEvent) };

  await fs.writeFile(filePath, JSON.stringify(trace), 'utf-8');

  return filePath;
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
};
