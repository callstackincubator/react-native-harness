import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createIosDeviceAppMonitor,
  createIosSimulatorAppMonitor,
  createUnifiedLogEvent,
} from '../app-monitor.js';
import * as simctl from '../xcrun/simctl.js';
import * as devicectl from '../xcrun/devicectl.js';
import * as diagnostics from '../crash-diagnostics.js';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import type { Subprocess } from '@react-native-harness/tools';

const createStreamingSubprocess = (
  chunks: Array<{ line: string; delayMs?: number }>
): Subprocess =>
  ({
    nodeChildProcess: Promise.resolve({
      kill: vi.fn(),
    }),
    [Symbol.asyncIterator]: async function* () {
      for (const { line, delayMs = 0 } of chunks) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        yield line;
      }
    },
  } as unknown as Subprocess);

const artifactRoot = fs.mkdtempSync(
  join(tmpdir(), 'rn-harness-ios-monitor-artifacts-')
);

describe('createUnifiedLogEvent', () => {
  it('extracts crash details from simulator log lines', () => {
    const event = createUnifiedLogEvent({
      line: '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
      processNames: ['HarnessPlayground', 'com.harnessplayground'],
    });

    expect(event).toMatchObject({
      type: 'possible_crash',
      source: 'logs',
      isConfirmed: true,
      crashDetails: {
        source: 'logs',
        processName: 'HarnessPlayground',
        pid: 1234,
        exceptionType: 'NSInternalInconsistencyException',
      },
    });
  });

  it('detects Swift fatal errors from simulator logs', () => {
    const event = createUnifiedLogEvent({
      line: '2026-03-13 10:29:13.868 Df HarnessPlayground[34784:8f92b3] (libswiftCore.dylib) HarnessPlayground/AppDelegate.swift:31: Fatal error: Intentional pre-RN startup crash',
      processNames: ['HarnessPlayground', 'com.harnessplayground'],
    });

    expect(event).toMatchObject({
      type: 'possible_crash',
      source: 'logs',
      isConfirmed: true,
      crashDetails: {
        source: 'logs',
        processName: 'HarnessPlayground',
        pid: 34784,
      },
    });
  });

  it('ignores unrelated lines that only mention the bundle identifier', () => {
    const event = createUnifiedLogEvent({
      line: '2026-03-12 11:35:08.000 runningboardd[55:aaaa] Acquiring assertion for com.harnessplayground',
      processNames: ['HarnessPlayground', 'com.harnessplayground'],
    });

    expect(event).toBeNull();
  });
});

afterEach(() => {
  fs.rmSync(artifactRoot, { recursive: true, force: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
});

describe('createIosSimulatorAppMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts simctl log stream', async () => {
    const streamLogsSpy = vi
      .spyOn(simctl, 'streamLogs')
      .mockReturnValue(createStreamingSubprocess([]));

    vi.spyOn(simctl, 'getAppInfo').mockResolvedValue({
      Bundle: 'com.harnessplayground',
      CFBundleIdentifier: 'com.harnessplayground',
      CFBundleExecutable: 'HarnessPlayground',
      CFBundleName: 'HarnessPlayground',
      CFBundleDisplayName: 'Harness Playground',
      Path: '/tmp/HarnessPlayground.app',
    });

    const monitor = createIosSimulatorAppMonitor({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
    });

    await monitor.start();
    await monitor.stop();

    expect(streamLogsSpy).toHaveBeenCalledWith(
      'sim-udid',
      'process == "HarnessPlayground" OR process == "com.harnessplayground"'
    );
  });

  it('returns best-effort simulator crash details from recent log blocks', async () => {
    vi.spyOn(simctl, 'streamLogs').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
        },
        {
          line: '2026-03-12 11:35:08.010 HarnessPlayground[1234:abcd] *** First throw call stack:',
          delayMs: 10,
        },
      ])
    );
    vi.spyOn(diagnostics, 'waitForCrashArtifact').mockResolvedValue({
      source: 'logs',
      processName: 'HarnessPlayground',
      pid: 1234,
      exceptionType: 'NSInternalInconsistencyException',
      summary:
        '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
      rawLines: [
        '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
      ],
    });
    vi.spyOn(simctl, 'getAppInfo').mockResolvedValue({
      Bundle: 'com.harnessplayground',
      CFBundleIdentifier: 'com.harnessplayground',
      CFBundleExecutable: 'HarnessPlayground',
      CFBundleName: 'HarnessPlayground',
      CFBundleDisplayName: 'Harness Playground',
      Path: '/tmp/HarnessPlayground.app',
    });

    const monitor = createIosSimulatorAppMonitor({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
    });

    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const details = await monitor.getCrashDetails({
      pid: 1234,
      occurredAt: Date.now(),
    });

    await monitor.stop();

    expect(details).toMatchObject({
      processName: 'HarnessPlayground',
      pid: 1234,
      exceptionType: 'NSInternalInconsistencyException',
    });
  });

  it('prefers a matched simulator crash report when one is found', async () => {
    vi.spyOn(simctl, 'streamLogs').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
        },
      ])
    );
    const sourcePath = join(
      artifactRoot,
      'HarnessPlayground-2026-03-12-122756.ips'
    );
    fs.writeFileSync(sourcePath, 'simulator crash report', 'utf8');
    vi.spyOn(diagnostics, 'waitForCrashArtifact').mockResolvedValue({
      artifactType: 'ios-crash-report',
      artifactPath: sourcePath,
      processName: 'HarnessPlayground',
      pid: 1234,
      signal: 'SIGTRAP',
      exceptionType: 'EXC_BREAKPOINT',
      summary: 'simulator crash report',
      rawLines: ['simulator crash report'],
    });
    vi.spyOn(simctl, 'getAppInfo').mockResolvedValue({
      Bundle: 'com.harnessplayground',
      CFBundleIdentifier: 'com.harnessplayground',
      CFBundleExecutable: 'HarnessPlayground',
      CFBundleName: 'HarnessPlayground',
      CFBundleDisplayName: 'Harness Playground',
      Path: '/tmp/HarnessPlayground.app',
    });

    const monitor = createIosSimulatorAppMonitor({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
      crashArtifactWriter: createCrashArtifactWriter({
        runnerName: 'ios-simulator',
        platformId: 'ios',
        rootDir: join(artifactRoot, '.harness', 'crash-reports'),
        runTimestamp: '2026-03-12T11-35-08-000Z',
      }),
    });

    await monitor.start();
    const details = await monitor.getCrashDetails({
      pid: 1234,
      occurredAt: Date.now(),
    });
    await monitor.stop();

    expect(details).toMatchObject({
      artifactType: 'ios-crash-report',
      summary: 'simulator crash report',
    });
  });
});

describe('createIosDeviceAppMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('polls device processes and emits app_exited when the app disappears', async () => {
    vi.spyOn(devicectl, 'getAppInfo').mockResolvedValue({
      bundleIdentifier: 'com.harnessplayground',
      name: 'HarnessPlayground',
      version: '1.0',
      url: '/private/var/HarnessPlayground.app',
    });
    vi.spyOn(diagnostics, 'collectCrashArtifacts').mockResolvedValue([]);
    const getProcesses = vi
      .spyOn(devicectl, 'getProcesses')
      .mockResolvedValueOnce([
        {
          executable: '/private/var/HarnessPlayground.app/HarnessPlayground',
          processIdentifier: 4321,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);

    const events: Array<{ type: string }> = [];
    const monitor = createIosDeviceAppMonitor({
      deviceId: 'device-udid',
      bundleId: 'com.harnessplayground',
    });
    monitor.addListener((event) => {
      events.push(event);
    });

    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await monitor.stop();

    expect(getProcesses).toHaveBeenCalled();
    expect(events.some((event) => event.type === 'app_exited')).toBe(true);
  });

  it('enriches device crashes with Apple-native pulled crash reports', async () => {
    vi.spyOn(devicectl, 'getAppInfo').mockResolvedValue({
      bundleIdentifier: 'com.harnessplayground',
      name: 'HarnessPlayground',
      version: '1.0',
      url: '/private/var/HarnessPlayground.app',
    });
    vi.spyOn(devicectl, 'getProcesses').mockResolvedValue([]);
    vi.spyOn(diagnostics, 'collectCrashArtifacts').mockResolvedValue([]);

    const sourcePath = join(artifactRoot, 'HarnessPlayground.crash');
    fs.writeFileSync(sourcePath, 'full crash report', 'utf8');
    vi.spyOn(diagnostics, 'waitForCrashArtifact').mockResolvedValue({
      artifactType: 'ios-crash-report',
      artifactPath: sourcePath,
      processName: 'HarnessPlayground',
      pid: 1234,
      signal: 'SIGABRT',
      exceptionType: 'NSInternalInconsistencyException',
      summary: 'full crash report',
      rawLines: ['full crash report'],
    });

    const monitor = createIosDeviceAppMonitor({
      deviceId: 'device-udid',
      bundleId: 'com.harnessplayground',
      crashArtifactWriter: createCrashArtifactWriter({
        runnerName: 'ios-device',
        platformId: 'ios',
        rootDir: join(artifactRoot, '.harness', 'crash-reports'),
        runTimestamp: '2026-03-12T11-35-08-000Z',
      }),
    });

    await monitor.start();
    const details = await monitor.getCrashDetails({
      pid: 1234,
      occurredAt: Date.now(),
    });
    await monitor.stop();

    expect(details).toMatchObject({
      artifactType: 'ios-crash-report',
      summary: 'full crash report',
    });
  });
});
