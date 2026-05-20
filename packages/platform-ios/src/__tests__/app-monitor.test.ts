import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeCrashError } from '@react-native-harness/platforms';
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
      platform: 'ios-simulator',
    });

    expect(event).toMatchObject({
      type: 'crash_suspected',
      crashDetails: {
        platform: 'ios-simulator',
        kind: 'native-crash',
        confidence: 'medium',
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
      platform: 'ios-simulator',
    });

    expect(event).toMatchObject({
      type: 'crash_suspected',
      crashDetails: {
        platform: 'ios-simulator',
        kind: 'native-crash',
        confidence: 'medium',
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
      platform: 'ios-simulator',
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
      isAppRunning: async () => true,
    });

    await monitor.start();
    await monitor.stop();

    expect(streamLogsSpy).toHaveBeenCalledWith(
      'sim-udid',
      'process == "HarnessPlayground" OR process == "com.harnessplayground"'
    );
  });

  it('reports simulator lifecycle and crash events through the reporter', async () => {
    vi.useFakeTimers();

    const eventReporter = vi.fn();
    vi.spyOn(simctl, 'streamLogs').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
        },
      ])
    );
    vi.spyOn(diagnostics, 'waitForCrashArtifact').mockResolvedValue({
      artifactType: 'ios-crash-report',
      artifactPath: '/tmp/report.ips',
      processName: 'HarnessPlayground',
      pid: 1234,
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
    const isAppRunning = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false);

    const monitor = createIosSimulatorAppMonitor({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
      isAppRunning,
      eventReporter,
    });
    const crashWatch = monitor.watch('example.test.ts', 'startup');
    crashWatch.promise.catch(() => undefined);

    try {
      await monitor.start();
      monitor.launchRequested({
        type: 'launch_requested',
        launchId: 'launch-1',
        at: Date.now(),
        reason: 'start',
      });
      monitor.launchCompleted({
        type: 'launch_completed',
        launchId: 'launch-1',
        at: Date.now(),
        reason: 'start',
      });
      await vi.advanceTimersByTimeAsync(1010);

      expect(eventReporter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'app:crash-suspected',
          appPlatform: 'ios-simulator',
          targetIdentifier: 'sim-udid',
          launchId: 'launch-1',
        }),
      );
      expect(eventReporter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'app:crash-confirmed',
          appPlatform: 'ios-simulator',
          targetIdentifier: 'sim-udid',
        }),
      );
      expect(eventReporter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'app:crash-report-ready',
          appPlatform: 'ios-simulator',
          artifactType: 'ios-crash-report',
        }),
      );
      expect(eventReporter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'app:exited',
          appPlatform: 'ios-simulator',
        }),
      );

      await monitor.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects the watch with best-effort simulator crash details from recent log blocks', async () => {
    vi.useFakeTimers();

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
    const isAppRunning = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false);
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
      isAppRunning,
    });
    const crashWatch = monitor.watch('example.test.ts', 'startup');
    crashWatch.promise.catch(() => undefined);

    try {
      await monitor.start();
      monitor.launchRequested({
        type: 'launch_requested',
        launchId: 'launch-1',
        at: Date.now(),
        reason: 'start',
      });
      monitor.launchCompleted({
        type: 'launch_completed',
        launchId: 'launch-1',
        at: Date.now(),
        reason: 'start',
      });
      await vi.advanceTimersByTimeAsync(1010);
      await expect(crashWatch.promise).rejects.toBeInstanceOf(NativeCrashError);
      await expect(crashWatch.promise).rejects.toMatchObject({
        testFilePath: 'example.test.ts',
        details: {
          phase: 'startup',
          processName: 'HarnessPlayground',
          pid: 1234,
          exceptionType: 'NSInternalInconsistencyException',
        },
      });

      await monitor.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects the watch with a matched simulator crash report when one is found', async () => {
    vi.useFakeTimers();

    vi.spyOn(simctl, 'streamLogs').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
        },
      ])
    );
    const isAppRunning = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false);
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
      isAppRunning,
      crashArtifactWriter: createCrashArtifactWriter({
        runnerName: 'ios-simulator',
        platformId: 'ios',
        rootDir: join(artifactRoot, '.harness', 'crash-reports'),
        runTimestamp: '2026-03-12T11-35-08-000Z',
      }),
    });
    const crashWatch = monitor.watch('example.test.ts', 'startup');
    crashWatch.promise.catch(() => undefined);

    try {
      await monitor.start();
      monitor.launchRequested({
        type: 'launch_requested',
        launchId: 'launch-1',
        at: Date.now(),
        reason: 'start',
      });
      monitor.launchCompleted({
        type: 'launch_completed',
        launchId: 'launch-1',
        at: Date.now(),
        reason: 'start',
      });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(crashWatch.promise).rejects.toMatchObject({
        details: {
          artifactType: 'ios-crash-report',
          summary: 'simulator crash report',
        },
      });
      await monitor.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createIosDeviceAppMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects the watch when the app disappears from device processes', async () => {
    vi.spyOn(devicectl, 'getAppInfo').mockResolvedValue({
      bundleIdentifier: 'com.harnessplayground',
      name: 'HarnessPlayground',
      version: '1.0',
      url: '/private/var/HarnessPlayground.app',
    });
    vi.spyOn(diagnostics, 'collectCrashArtifacts').mockResolvedValue([]);
    vi.spyOn(diagnostics, 'waitForCrashArtifact').mockResolvedValue(null);
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

    const monitor = createIosDeviceAppMonitor({
      deviceId: 'device-udid',
      bundleId: 'com.harnessplayground',
      isAppRunning: async () => false,
    });
    const crashWatch = monitor.watch('example.test.ts', 'execution');
    crashWatch.promise.catch(() => undefined);

    await monitor.start();
    monitor.launchRequested({
      type: 'launch_requested',
      launchId: 'launch-1',
      at: Date.now(),
      reason: 'start',
    });
    monitor.launchCompleted({
      type: 'launch_completed',
      launchId: 'launch-1',
      at: Date.now(),
      reason: 'start',
    });
    await expect(crashWatch.promise).rejects.toMatchObject({
      details: {
        phase: 'execution',
        platform: 'ios-device',
        source: 'polling',
        processName: 'HarnessPlayground',
        pid: 4321,
      },
    });
    await monitor.stop();

    expect(getProcesses).toHaveBeenCalled();
  });

  it('rejects the watch with Apple-native pulled crash reports for device crashes', async () => {
    vi.spyOn(devicectl, 'getAppInfo').mockResolvedValue({
      bundleIdentifier: 'com.harnessplayground',
      name: 'HarnessPlayground',
      version: '1.0',
      url: '/private/var/HarnessPlayground.app',
    });
    vi.spyOn(devicectl, 'getProcesses')
      .mockResolvedValueOnce([
        {
          executable: '/private/var/HarnessPlayground.app/HarnessPlayground',
          processIdentifier: 1234,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
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
      isAppRunning: async () => false,
      crashArtifactWriter: createCrashArtifactWriter({
        runnerName: 'ios-device',
        platformId: 'ios',
        rootDir: join(artifactRoot, '.harness', 'crash-reports'),
        runTimestamp: '2026-03-12T11-35-08-000Z',
      }),
    });
    const crashWatch = monitor.watch('example.test.ts', 'execution');
    crashWatch.promise.catch(() => undefined);

    await monitor.start();
    monitor.launchRequested({
      type: 'launch_requested',
      launchId: 'launch-1',
      at: Date.now(),
      reason: 'start',
    });
    monitor.launchCompleted({
      type: 'launch_completed',
      launchId: 'launch-1',
      at: Date.now(),
      reason: 'start',
    });
    await expect(crashWatch.promise).rejects.toMatchObject({
      details: {
        artifactType: 'ios-crash-report',
        summary: 'full crash report',
      },
    });
    await monitor.stop();
  });
});
