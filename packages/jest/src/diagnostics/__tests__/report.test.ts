import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDiagnostics,
  type DiagnosticEntry,
} from '@react-native-harness/tools';
import {
  appendStepSummary,
  createDiagnosticsAppender,
  printSummary,
  summarizeRunKpis,
  writeSummaryFile,
  writeTraceFile,
} from '../report.js';

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

const makeGaugeEntry = (
  label: string,
  value: number,
  startTime = 1_000,
  attrs?: DiagnosticEntry['attrs'],
): DiagnosticEntry => ({
  label,
  startTime,
  duration: 0,
  status: 'ok',
  kind: 'gauge',
  value,
  attrs,
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

  it('writes gauges as Chrome trace counter events', async () => {
    const entries = [
      makeGaugeEntry('host.mem.compressed', 1234.5, 2_000),
      makeGaugeEntry('host.load1', 7.25, 2_000, { phase: 'ignored' }),
    ];

    const filePath = await writeTraceFile(entries, {
      projectRoot,
      runId: 'run-gauges',
    });

    const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8')) as {
      traceEvents: Array<Record<string, unknown>>;
    };
    expect(parsed.traceEvents).toEqual([
      {
        name: 'host.mem.compressed',
        ph: 'C',
        ts: 2_000 * 1000,
        pid: 1,
        tid: 1,
        args: { 'host.mem.compressed': 1234.5 },
      },
      {
        name: 'host.load1',
        ph: 'C',
        ts: 2_000 * 1000,
        pid: 1,
        tid: 1,
        args: { 'host.load1': 7.25 },
      },
    ]);
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

  it('leaves gauges out of the timing stats and prints the KPIs', () => {
    const lines: string[] = [];
    printSummary(
      [
        makeSpanEntry({ label: 'platform.ios.simctl.waitForBoot', duration: 58_000 }),
        makeGaugeEntry('host.load1', 12.34),
        makeGaugeEntry('host.mem.compressed', 4096),
      ],
      (line) => lines.push(line),
    );

    expect(lines.some((l) => l.includes('host.load1'))).toBe(false);
    expect(lines).toContain('  KPIs');
    expect(lines).toContain('    Boot wait: 58.0s');
    expect(lines).toContain('    Peak host load (1m): 12.3');
    expect(lines).toContain('    Peak compressed memory: 4096 MB');
    expect(lines).toContain('    Max event loop lag: n/a');
  });
});

describe('summarizeRunKpis', () => {
  it('derives every KPI from the entries', () => {
    const entries: DiagnosticEntry[] = [
      makeSpanEntry({ label: 'session.config.load', startTime: 1_000, duration: 100 }),
      makeSpanEntry({
        label: 'platform.ios.simctl.waitForBoot',
        startTime: 1_200,
        duration: 58_000,
      }),
      makeSpanEntry({
        label: 'app.ready.total',
        startTime: 70_000,
        duration: 5_000,
        attrs: { reused: false },
      }),
      makeSpanEntry({
        label: 'app.ready.total',
        startTime: 90_000,
        duration: 10,
        attrs: { reused: true },
      }),
      makeSpanEntry({ label: 'run.file', attrs: { file: 'a' } }),
      makeSpanEntry({ label: 'run.file', attrs: { file: 'b' } }),
      makeSpanEntry({ label: 'run.total', attrs: { status: 'failed' } }),
      makeGaugeEntry('host.mem.compressed', 800),
      makeGaugeEntry('host.mem.compressed', 2600),
      makeGaugeEntry('host.mem.compressed', 1500),
      makeGaugeEntry('host.load1', 3),
      makeGaugeEntry('host.load1', 410.5),
      makeGaugeEntry('host.mem.free', 900),
      makeGaugeEntry('host.mem.free', 60),
      makeGaugeEntry('host.mem.swapouts', 100),
      makeGaugeEntry('host.mem.swapouts', 250),
      makeGaugeEntry('host.mem.swapouts', 400),
      makeGaugeEntry('node.event_loop.max_ms', 15),
      makeGaugeEntry('node.event_loop.max_ms', 1900),
    ];

    expect(summarizeRunKpis(entries)).toEqual({
      bootWaitMs: 58_000,
      timeToReadyMs: 74_000,
      peakHostCompressedMb: 2600,
      peakLoad1: 410.5,
      minHostFreeMb: 60,
      swapoutsDelta: 300,
      maxEventLoopLagMs: 1900,
      testFileCount: 2,
      result: 'failed',
    });
  });

  it('reports null for anything it cannot derive', () => {
    expect(summarizeRunKpis([])).toEqual({
      bootWaitMs: null,
      timeToReadyMs: null,
      peakHostCompressedMb: null,
      peakLoad1: null,
      minHostFreeMb: null,
      swapoutsDelta: null,
      maxEventLoopLagMs: null,
      testFileCount: 0,
      result: null,
    });
  });

  it('needs two samples to compute a swapouts delta and ignores failed app readiness', () => {
    const kpis = summarizeRunKpis([
      makeSpanEntry({ label: 'session.config.load', startTime: 0 }),
      makeSpanEntry({ label: 'app.ready.total', status: 'error' }),
      makeGaugeEntry('host.mem.swapouts', 100),
    ]);

    expect(kpis.swapoutsDelta).toBeNull();
    expect(kpis.timeToReadyMs).toBeNull();
  });
});

describe('writeSummaryFile', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-summary-test-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('writes <runId>.summary.json with the run and session ids', async () => {
    const kpis = summarizeRunKpis([makeSpanEntry({ label: 'run.file' })]);

    const filePath = await writeSummaryFile(kpis, {
      projectRoot,
      runId: 'run-1',
      sessionId: 'session-1',
    });

    expect(filePath).toBe(
      path.join(projectRoot, '.harness', 'diagnostics', 'run-1.summary.json'),
    );
    expect(JSON.parse(await fs.readFile(filePath, 'utf-8'))).toEqual({
      runId: 'run-1',
      sessionId: 'session-1',
      ...kpis,
    });
  });
});

describe('appendStepSummary', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-step-summary-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const kpis = summarizeRunKpis([
    makeSpanEntry({ label: 'platform.ios.simctl.waitForBoot', duration: 143_000 }),
    makeSpanEntry({ label: 'run.total', attrs: { status: 'passed' } }),
  ]);

  it('appends a markdown table to GITHUB_STEP_SUMMARY', async () => {
    const summaryPath = path.join(dir, 'summary.md');
    await fs.writeFile(summaryPath, '# Existing\n');

    await appendStepSummary(kpis, { GITHUB_STEP_SUMMARY: summaryPath });

    const content = await fs.readFile(summaryPath, 'utf-8');
    expect(content.startsWith('# Existing\n')).toBe(true);
    expect(content).toContain('### Harness run KPIs');
    expect(content).toContain('| KPI | Value |');
    expect(content).toContain('| Boot wait | 143.0s |');
    expect(content).toContain('| Result | passed |');
  });

  it('does nothing outside GitHub Actions', async () => {
    await expect(appendStepSummary(kpis, {})).resolves.toBeUndefined();
  });

  it('swallows write failures', async () => {
    await expect(
      appendStepSummary(kpis, {
        GITHUB_STEP_SUMMARY: path.join(dir, 'missing-dir', 'summary.md'),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('createDiagnosticsAppender', () => {
  let projectRoot: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-appender-test-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const readLines = async (filePath: string) =>
    (await fs.readFile(filePath, 'utf-8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DiagnosticEntry);

  it('writes entries as one JSON object per line, flushed on a timer', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const appender = createDiagnosticsAppender(diagnostics, {
      projectRoot,
      id: 'session-1',
    });
    expect(appender.filePath).toBe(
      path.join(projectRoot, '.harness', 'diagnostics', 'session-1.jsonl'),
    );

    diagnostics.mark('a');
    diagnostics.child('host').gauge('load1', 2.5);
    await expect(fs.stat(appender.filePath)).rejects.toThrow();

    vi.advanceTimersByTime(2000);

    const entries = await readLines(appender.filePath);
    expect(entries.map((e) => [e.label, e.kind, e.value])).toEqual([
      ['a', 'mark', undefined],
      ['host.load1', 'gauge', 2.5],
    ]);

    appender.dispose();
  });

  it('flushes as soon as enough entries are buffered', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const appender = createDiagnosticsAppender(diagnostics, {
      projectRoot,
      id: 'batch',
      maxBufferedEntries: 3,
    });

    diagnostics.mark('1');
    diagnostics.mark('2');
    await expect(fs.stat(appender.filePath)).rejects.toThrow();
    diagnostics.mark('3');

    expect(await readLines(appender.filePath)).toHaveLength(3);
    appender.dispose();
  });

  it('keeps entries that the run report flushes out of the diagnostics buffer', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const appender = createDiagnosticsAppender(diagnostics, {
      projectRoot,
      id: 'independent',
    });

    diagnostics.mark('a');
    expect(diagnostics.flush()).toHaveLength(1);
    appender.flush();

    expect(await readLines(appender.filePath)).toHaveLength(1);
    appender.dispose();
  });

  it('flushes on dispose and stops observing afterwards', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const appender = createDiagnosticsAppender(diagnostics, {
      projectRoot,
      id: 'dispose',
    });

    diagnostics.mark('before');
    appender.dispose();
    diagnostics.mark('after');
    appender.flush();

    expect((await readLines(appender.filePath)).map((e) => e.label)).toEqual([
      'before',
    ]);
  });

  it('flushes on process exit', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const appender = createDiagnosticsAppender(diagnostics, {
      projectRoot,
      id: 'exit',
    });

    diagnostics.mark('last-words');
    process.emit('exit', 0);

    expect(await readLines(appender.filePath)).toHaveLength(1);
    appender.dispose();
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'flushes on %s and leaves other handlers in charge of termination',
    async (signal) => {
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const otherHandler = vi.fn();
      process.on(signal, otherHandler);
      const diagnostics = createDiagnostics({ enabled: true });
      const appender = createDiagnosticsAppender(diagnostics, {
        projectRoot,
        id: `signal-${signal}`,
      });

      diagnostics.mark('before-kill');
      process.emit(signal);

      expect(await readLines(appender.filePath)).toHaveLength(1);
      expect(kill).not.toHaveBeenCalled();

      appender.dispose();
      process.off(signal, otherHandler);
    },
  );

  it('re-raises the signal when it was the only handler', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const baseline = process.listenerCount('SIGTERM');
    const diagnostics = createDiagnostics({ enabled: true });
    const appender = createDiagnosticsAppender(diagnostics, {
      projectRoot,
      id: 'only-handler',
    });
    // Only ours is registered if nothing else was (the common test setup).
    const others = process.listeners('SIGTERM').slice(0, baseline);
    others.forEach((listener) => process.off('SIGTERM', listener));

    diagnostics.mark('x');
    process.emit('SIGTERM');

    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    expect(process.listenerCount('SIGTERM')).toBe(0);

    others.forEach((listener) => process.on('SIGTERM', listener));
    appender.dispose();
  });

  it('removes every process listener on dispose', () => {
    const before = {
      exit: process.listenerCount('exit'),
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
    };
    const appender = createDiagnosticsAppender(
      createDiagnostics({ enabled: true }),
      { projectRoot, id: 'listeners' },
    );
    appender.dispose();

    expect({
      exit: process.listenerCount('exit'),
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
    }).toEqual(before);
  });

  it('does nothing at all when diagnostics are disabled', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const before = process.listenerCount('exit');
    const diagnostics = createDiagnostics({ enabled: false });

    const appender = createDiagnosticsAppender(diagnostics, {
      projectRoot,
      id: 'disabled',
    });
    diagnostics.mark('a');
    appender.flush();
    appender.dispose();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(process.listenerCount('exit')).toBe(before);
    await expect(fs.stat(path.join(projectRoot, '.harness'))).rejects.toThrow();
  });

  it('never throws when the directory cannot be written', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const appender = createDiagnosticsAppender(diagnostics, {
      projectRoot: '/dev/null/nope',
      id: 'unwritable',
    });

    diagnostics.mark('a');
    expect(() => appender.flush()).not.toThrow();
    appender.dispose();
  });
});
