import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagnostics } from '@react-native-harness/tools';
import type { HarnessPlatformRunner } from '@react-native-harness/platforms';
import { writeTraceFile } from '../report.js';
import { startSessionTelemetry } from '../telemetry.js';

const onlyPlatformProbe = {
  diagnostics: {
    probes: { host: false, node: false, snapshots: false, platform: true },
  },
};

const makePlatform = (
  collect = vi
    .fn()
    .mockResolvedValue({ 'ios.simulator.guest_process_count': 312 })
) =>
  ({
    createTelemetryCollector: () => ({ collect }),
  } as unknown as HarnessPlatformRunner & {
    createTelemetryCollector: () => { collect: typeof collect };
  });

describe('startSessionTelemetry', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'harness-telemetry-test-')
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('starts nothing when diagnostics are disabled', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const exitListeners = process.listenerCount('exit');
    const diagnostics = createDiagnostics({ enabled: false });
    const collect = vi.fn();

    const telemetry = startSessionTelemetry({
      diagnostics,
      config: { diagnostics: true },
      projectRoot,
    });
    telemetry.attachPlatform(
      makePlatform(collect) as unknown as HarnessPlatformRunner
    );
    telemetry.phase('platform.ready');
    await telemetry.settled();
    await telemetry.dispose();

    expect(collect).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(process.listenerCount('exit')).toBe(exitListeners);
    await expect(fs.stat(path.join(projectRoot, '.harness'))).rejects.toThrow();
  });

  it('records the run context, drives the platform collector on lifecycle phases and persists everything', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const collect = vi
      .fn()
      .mockResolvedValue({ 'ios.simulator.guest_process_count': 312 });

    const telemetry = startSessionTelemetry({
      diagnostics,
      config: onlyPlatformProbe,
      projectRoot,
    });
    telemetry.attachPlatform(
      makePlatform(collect) as unknown as HarnessPlatformRunner
    );
    telemetry.phase('platform.ready');
    telemetry.phase('dispose');
    await telemetry.settled();
    await telemetry.dispose();

    expect(collect.mock.calls.map(([phase]) => phase)).toEqual([
      'platform.ready',
      'dispose',
    ]);

    const jsonl = await fs.readFile(
      path.join(
        projectRoot,
        '.harness',
        'diagnostics',
        `${telemetry.sessionId}.jsonl`
      ),
      'utf-8'
    );
    const labels = jsonl
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { label: string }).label);
    expect(labels).toEqual([
      'telemetry.context',
      'platform.ios.simulator.guest_process_count',
      'platform.ios.simulator.guest_process_count',
    ]);
  });

  it('respects the probe switches', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const collect = vi.fn().mockResolvedValue({});

    const telemetry = startSessionTelemetry({
      diagnostics,
      config: {
        diagnostics: {
          probes: {
            host: false,
            node: false,
            snapshots: false,
            platform: false,
          },
        },
      },
      projectRoot,
    });
    telemetry.attachPlatform(
      makePlatform(collect) as unknown as HarnessPlatformRunner
    );
    telemetry.phase('platform.ready');
    await telemetry.settled();
    await telemetry.dispose();

    expect(collect).not.toHaveBeenCalled();
    expect(diagnostics.flush().map((e) => e.label)).toEqual([
      'telemetry.context',
    ]);
  });

  it('samples host and node metrics on the configured interval and stops on dispose', async () => {
    vi.useFakeTimers();
    try {
      const diagnostics = createDiagnostics({ enabled: true });
      const telemetry = startSessionTelemetry({
        diagnostics,
        config: {
          diagnostics: {
            sampleIntervalMs: 1000,
            probes: { snapshots: false, platform: false },
          },
        },
        projectRoot,
      });

      await vi.advanceTimersByTimeAsync(2000);
      const samples = () =>
        diagnostics.flush().filter((e) => e.label === 'node.rss_mb').length;
      expect(samples()).toBe(3);

      await telemetry.dispose();
      await vi.advanceTimersByTimeAsync(5000);
      expect(samples()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds entries recorded after the run report to that run trace on dispose', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const telemetry = startSessionTelemetry({
      diagnostics,
      config: onlyPlatformProbe,
      projectRoot,
    });
    telemetry.attachPlatform(
      makePlatform() as unknown as HarnessPlatformRunner
    );
    telemetry.trackRun('run-1');

    // What executeRun does when the run ends: report, then flush.
    diagnostics.start('run.total').end();
    const reported = diagnostics.flush();
    await writeTraceFile(reported, { projectRoot, runId: 'run-1' });

    // Teardown: an end-of-run collection and the dispose span.
    telemetry.phase('dispose');
    await telemetry.settled();
    diagnostics.start('dispose.total').end();
    await telemetry.dispose();

    const trace = JSON.parse(
      await fs.readFile(
        path.join(projectRoot, '.harness', 'diagnostics', 'run-1.json'),
        'utf-8'
      )
    ) as { traceEvents: Array<{ name: string }> };
    expect(trace.traceEvents.map((e) => e.name)).toEqual([
      'telemetry.context',
      'run.total',
      'platform.ios.simulator.guest_process_count',
      'dispose.total',
    ]);
  });

  it('writes no trace on dispose when no run ever started', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const telemetry = startSessionTelemetry({
      diagnostics,
      config: onlyPlatformProbe,
      projectRoot,
    });

    await telemetry.dispose();

    const files = await fs.readdir(
      path.join(projectRoot, '.harness', 'diagnostics')
    );
    expect(files).toEqual([`${telemetry.sessionId}.jsonl`]);
  });

  it('dispose is idempotent', async () => {
    const telemetry = startSessionTelemetry({
      diagnostics: createDiagnostics({ enabled: true }),
      config: onlyPlatformProbe,
      projectRoot,
    });

    const first = telemetry.dispose();
    expect(telemetry.dispose()).toBe(first);
    await first;
  });

  it('tracks peak load, mean idle CPU, minimum free memory and swapouts as host pressure', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const telemetry = startSessionTelemetry({
      diagnostics,
      config: onlyPlatformProbe,
      projectRoot,
    });

    expect(telemetry.hostPressure()).toBeNull();

    diagnostics.gauge('host.load1', 4);
    diagnostics.gauge('host.mem.free', 800);
    diagnostics.gauge('host.mem.swapouts', 100);
    diagnostics.gauge('host.load1', 9.5);
    diagnostics.gauge('host.mem.free', 120);
    diagnostics.gauge('host.load1', 6);
    diagnostics.gauge('host.mem.swapouts', 700);
    diagnostics.gauge('host.cpu.idle_pct', 2);
    diagnostics.gauge('host.cpu.idle_pct', 6);

    expect(telemetry.hostPressure()).toEqual({
      peakLoad1: 9.5,
      meanIdlePct: 4,
      minHostFreeMb: 120,
      swapoutsDeltaMb: 600,
      cpuCount: os.availableParallelism(),
    });

    await telemetry.dispose();
  });
});
