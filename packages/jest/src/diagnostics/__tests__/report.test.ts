import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiagnosticEntry } from '@react-native-harness/tools';
import { printSummary, writeTraceFile } from '../report.js';

const makeSpanEntry = (
  overrides: Partial<DiagnosticEntry> = {},
): DiagnosticEntry => ({
  label: 'metro.bundle.build',
  startTime: 1_000,
  duration: 250,
  status: 'ok',
  kind: 'span',
  ...overrides,
});

describe('writeTraceFile', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'react-native-harness-report-test-'),
    );
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('writes a Chrome Trace Event JSON file under .harness/diagnostics', async () => {
    const entries = [
      makeSpanEntry({ attrs: { file: 'a.test.ts' } }),
      makeSpanEntry({
        label: 'bridge.connected',
        duration: 0,
        kind: 'mark',
      }),
    ];

    const filePath = await writeTraceFile(entries, {
      projectRoot,
      runId: 'run-123',
    });

    expect(filePath).toBe(
      path.join(projectRoot, '.harness', 'diagnostics', 'run-123.json'),
    );

    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { traceEvents: Array<Record<string, unknown>> };

    expect(parsed.traceEvents).toHaveLength(2);
    expect(parsed.traceEvents[0]).toMatchObject({
      name: 'metro.bundle.build',
      ph: 'X',
      ts: 1_000 * 1000,
      dur: 250 * 1000,
      pid: 1,
      tid: 1,
      args: { file: 'a.test.ts' },
    });
    expect(parsed.traceEvents[1]).toMatchObject({
      name: 'bridge.connected',
      ph: 'i',
      s: 'g',
    });
  });

  it('creates the diagnostics directory recursively when missing', async () => {
    const filePath = await writeTraceFile([makeSpanEntry()], {
      projectRoot,
      runId: 'run-456',
    });

    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });
});

describe('printSummary', () => {
  it('does nothing when there are no entries', () => {
    const lines: string[] = [];
    printSummary([], (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it('groups by top-level namespace and sorts labels by total duration desc', () => {
    const lines: string[] = [];
    printSummary(
      [
        makeSpanEntry({ label: 'metro.bundle.build', duration: 100 }),
        makeSpanEntry({ label: 'metro.bundle.build', duration: 200 }),
        makeSpanEntry({ label: 'metro.init', duration: 50 }),
        makeSpanEntry({ label: 'client.test', duration: 5000 }),
      ],
      (line) => lines.push(line),
    );

    const metroHeaderIndex = lines.indexOf('  metro');
    const clientHeaderIndex = lines.indexOf('  client');
    expect(metroHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(clientHeaderIndex).toBeGreaterThanOrEqual(0);

    const bundleLine = lines.find((l) => l.includes('metro.bundle.build'));
    expect(bundleLine).toContain('count=2');
    expect(bundleLine).toContain('total=300ms');
    expect(bundleLine).toContain('max=200ms');

    const clientLine = lines.find((l) => l.includes('client.test'));
    expect(clientLine).toContain('total=5.0s');
  });

  it('formats sub-second durations in ms and second+ durations in s', () => {
    const lines: string[] = [];
    printSummary(
      [
        makeSpanEntry({ label: 'a.b', duration: 999 }),
        makeSpanEntry({ label: 'a.c', duration: 1500 }),
      ],
      (line) => lines.push(line),
    );

    expect(lines.find((l) => l.includes('a.b'))).toContain('999ms');
    expect(lines.find((l) => l.includes('a.c'))).toContain('1.5s');
  });
});
