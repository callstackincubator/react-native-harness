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
import * as libimobiledevice from '../libimobiledevice.js';
import * as tools from '@react-native-harness/tools';
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
  }) as unknown as Subprocess;

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

  it('detects Swift fatal errors from idevicesyslog with library-qualified process name', () => {
    const event = createUnifiedLogEvent({
      line: 'Mar 13 12:27:13.724837 HarnessPlayground(libswiftCore.dylib)[21675] <Notice>: HarnessPlayground/AppDelegate.swift:31: Fatal error: Intentional pre-RN startup crash',
      processNames: ['HarnessPlayground', 'com.harnessplayground'],
    });

    expect(event).toMatchObject({
      type: 'possible_crash',
      source: 'logs',
      isConfirmed: true,
      crashDetails: {
        source: 'logs',
        processName: 'HarnessPlayground',
        pid: 21675,
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
    const spawnSpy = vi.spyOn(tools, 'spawn').mockReturnValue(
      createStreamingSubprocess([])
    );

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

    expect(spawnSpy).toHaveBeenCalledWith(
      'xcrun',
      [
        'simctl',
        'spawn',
        'sim-udid',
        'log',
        'stream',
        '--style',
        'compact',
        '--level',
        'info',
        '--predicate',
        'process == "HarnessPlayground" OR process == "com.harnessplayground"',
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
  });

  it('returns best-effort simulator crash details from recent log blocks', async () => {
    vi.spyOn(tools, 'spawn').mockReturnValue(
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
    vi.spyOn(simctl, 'collectCrashReports').mockResolvedValue([]);
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
    expect(details?.artifactType).toBeUndefined();
    expect(details?.artifactPath).toBeUndefined();
    expect(details?.rawLines).toEqual([
      '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
      '2026-03-12 11:35:08.010 HarnessPlayground[1234:abcd] *** First throw call stack:',
    ]);
  });

  it('prefers a matched simulator crash report when one is found', async () => {
    vi.spyOn(tools, 'spawn').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
        },
      ])
    );
    const sourcePath = join(artifactRoot, 'HarnessPlayground-2026-03-12-122756.ips');
    fs.writeFileSync(sourcePath, 'simulator crash report', 'utf8');
    vi.spyOn(simctl, 'collectCrashReports').mockImplementation(
      async ({ crashArtifactWriter }) => [
        {
          artifactType: 'ios-crash-report',
          artifactPath:
            crashArtifactWriter?.persistArtifact({
              artifactKind: 'ios-crash-report',
              source: {
                kind: 'file',
                path: sourcePath,
              },
            }) ?? sourcePath,
          occurredAt: Date.now(),
          processName: 'HarnessPlayground',
          pid: 1234,
          signal: 'SIGTRAP',
          exceptionType: 'EXC_BREAKPOINT',
          summary: 'simulator crash report',
          rawLines: ['simulator crash report'],
        },
      ]
    );
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
    await new Promise((resolve) => setTimeout(resolve, 10));

    const details = await monitor.getCrashDetails({
      pid: 1234,
      occurredAt: Date.now(),
    });

    await monitor.stop();

    expect(details).toMatchObject({
      artifactType: 'ios-crash-report',
      summary: 'simulator crash report',
    });
    expect(details?.artifactPath).toContain('/.harness/crash-reports/');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(fs.existsSync(details!.artifactPath!)).toBe(true);
  });

  it('waits for a simulator crash report to appear before falling back to logs', async () => {
    vi.spyOn(tools, 'spawn').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
        },
      ])
    );
    vi.spyOn(simctl, 'getAppInfo').mockResolvedValue({
      Bundle: 'com.harnessplayground',
      CFBundleIdentifier: 'com.harnessplayground',
      CFBundleExecutable: 'HarnessPlayground',
      CFBundleName: 'HarnessPlayground',
      CFBundleDisplayName: 'Harness Playground',
      Path: '/tmp/HarnessPlayground.app',
    });

    let calls = 0;
    vi.spyOn(simctl, 'collectCrashReports').mockImplementation(async () => {
      calls += 1;

      if (calls === 1) {
        return [];
      }

      return [
        {
          artifactType: 'ios-crash-report',
          artifactPath: '/tmp/HarnessPlayground.ips',
          occurredAt: Date.now(),
          processName: 'HarnessPlayground',
          pid: 1234,
          signal: 'SIGTRAP',
          exceptionType: 'EXC_BREAKPOINT',
          stackTrace: ['0 AppDelegate.crashIfRequested() (AppDelegate.swift:31)'],
          rawLines: ['simulator crash report'],
        },
      ];
    });

    const monitor = createIosSimulatorAppMonitor({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
    });

    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const details = await monitor.getCrashDetails({
      pid: 1234,
      occurredAt: Date.now(),
    });

    await monitor.stop();

    expect(calls).toBe(2);
    expect(details).toMatchObject({
      artifactType: 'ios-crash-report',
      stackTrace: ['0 AppDelegate.crashIfRequested() (AppDelegate.swift:31)'],
    });
  });

  it('does not emit generic simulator log noise', async () => {
    vi.spyOn(tools, 'spawn').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '2026-03-12 11:35:08.000 runningboardd[55:aaaa] Acquiring assertion for com.harnessplayground',
        },
        {
          line: '2026-03-12 11:35:08.010 HarnessPlayground[1234:abcd] app-specific log line',
          delayMs: 10,
        },
      ])
    );
    vi.spyOn(simctl, 'getAppInfo').mockResolvedValue({
      Bundle: 'com.harnessplayground',
      CFBundleIdentifier: 'com.harnessplayground',
      CFBundleExecutable: 'HarnessPlayground',
      CFBundleName: 'HarnessPlayground',
      CFBundleDisplayName: 'Harness Playground',
      Path: '/tmp/HarnessPlayground.app',
    });

    const lines: string[] = [];
    const monitor = createIosSimulatorAppMonitor({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
    });
    monitor.addListener((event) => {
      if (event.type === 'log') {
        lines.push(event.line);
      }
    });

    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await monitor.stop();

    expect(lines).toEqual([
      '2026-03-12 11:35:08.010 HarnessPlayground[1234:abcd] app-specific log line',
    ]);
  });

  it('cleans up the background simctl process on stop', async () => {
    const kill = vi.fn();
    vi.spyOn(tools, 'spawn').mockReturnValue({
      nodeChildProcess: Promise.resolve({ kill }),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      [Symbol.asyncIterator]: async function* () {},
    } as unknown as Subprocess);
    vi.spyOn(simctl, 'getAppInfo').mockResolvedValue(null);

    const monitor = createIosSimulatorAppMonitor({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
    });

    await monitor.start();
    await monitor.stop();

    expect(kill).toHaveBeenCalled();
  });
});

describe('createIosDeviceAppMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses libimobiledevice for physical device log streaming', async () => {
    const syslogSpy = vi
      .spyOn(libimobiledevice, 'createSyslogProcess')
      .mockReturnValue(createStreamingSubprocess([]));
    const targetSpy = vi
      .spyOn(libimobiledevice, 'assertLibimobiledeviceTargetAvailable')
      .mockResolvedValue(undefined);
    vi.spyOn(devicectl, 'getAppInfo').mockResolvedValue({
      bundleIdentifier: 'com.harnessplayground',
      name: 'HarnessPlayground',
      version: '1.0',
      url: '/private/var/HarnessPlayground.app',
    });

    const monitor = createIosDeviceAppMonitor({
      deviceId: 'device-udid',
      libimobiledeviceUdid: 'hardware-udid',
      bundleId: 'com.harnessplayground',
    });

    await monitor.start();
    await monitor.stop();

    expect(targetSpy).toHaveBeenCalledWith('hardware-udid');
    expect(syslogSpy).toHaveBeenCalledWith({
      targetId: 'hardware-udid',
      processNames: ['com.harnessplayground', 'HarnessPlayground'],
    });
  });

  it('detects idevicesyslog crash lines with library-qualified process names', async () => {
    vi.spyOn(libimobiledevice, 'assertLibimobiledeviceTargetAvailable').mockResolvedValue(
      undefined
    );
    vi.spyOn(libimobiledevice, 'createSyslogProcess').mockReturnValue(
      createStreamingSubprocess([
        {
          line: 'Mar 13 12:27:13.724837 HarnessPlayground(libswiftCore.dylib)[21675] <Notice>: HarnessPlayground/AppDelegate.swift:31: Fatal error: Intentional pre-RN startup crash',
        },
      ])
    );
    vi.spyOn(libimobiledevice, 'collectCrashReports').mockResolvedValue([]);
    vi.spyOn(devicectl, 'getAppInfo').mockResolvedValue({
      bundleIdentifier: 'com.harnessplayground',
      name: 'HarnessPlayground',
      version: '1.0',
      url: '/private/var/HarnessPlayground.app',
    });

    const events: Array<{ type: string }> = [];
    const monitor = createIosDeviceAppMonitor({
      deviceId: 'device-udid',
      libimobiledeviceUdid: 'hardware-udid',
      bundleId: 'com.harnessplayground',
    });
    monitor.addListener((event) => {
      events.push(event);
    });

    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const details = await monitor.getCrashDetails({
      pid: 21675,
      occurredAt: Date.now(),
    });

    await monitor.stop();

    expect(events.some((event) => event.type === 'possible_crash')).toBe(true);
    expect(details).toMatchObject({
      source: 'logs',
      processName: 'HarnessPlayground',
      pid: 21675,
    });
  });

  it('still enriches device crashes with pulled crash reports', async () => {
    vi.spyOn(libimobiledevice, 'assertLibimobiledeviceTargetAvailable').mockResolvedValue(
      undefined
    );
    vi.spyOn(libimobiledevice, 'createSyslogProcess').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '2026-03-12 11:35:08.000 HarnessPlayground[1234:abcd] Terminating app due to uncaught exception: NSInternalInconsistencyException',
        },
      ])
    );
    const sourcePath = join(artifactRoot, 'HarnessPlayground.crash');
    fs.writeFileSync(sourcePath, 'full crash report', 'utf8');
    vi.spyOn(libimobiledevice, 'collectCrashReports').mockImplementation(
      async ({ crashArtifactWriter }) => [
        {
          artifactType: 'ios-crash-report',
          artifactPath:
            crashArtifactWriter?.persistArtifact({
              artifactKind: 'ios-crash-report',
              source: {
                kind: 'file',
                path: sourcePath,
              },
            }) ?? sourcePath,
          occurredAt: Date.now(),
          processName: 'HarnessPlayground',
          pid: 1234,
          signal: 'SIGABRT',
          exceptionType: 'NSInternalInconsistencyException',
          summary: 'full crash report',
          rawLines: ['full crash report'],
        },
      ]
    );
    vi.spyOn(devicectl, 'getAppInfo').mockResolvedValue({
      bundleIdentifier: 'com.harnessplayground',
      name: 'HarnessPlayground',
      version: '1.0',
      url: '/private/var/HarnessPlayground.app',
    });

    const monitor = createIosDeviceAppMonitor({
      deviceId: 'device-udid',
      libimobiledeviceUdid: 'hardware-udid',
      bundleId: 'com.harnessplayground',
      crashArtifactWriter: createCrashArtifactWriter({
        runnerName: 'ios-device',
        platformId: 'ios',
        rootDir: join(artifactRoot, '.harness', 'crash-reports'),
        runTimestamp: '2026-03-12T11-35-08-000Z',
      }),
    });

    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const details = await monitor.getCrashDetails({
      pid: 1234,
      occurredAt: Date.now(),
    });

    await monitor.stop();

    expect(details).toMatchObject({
      artifactType: 'ios-crash-report',
      summary: 'full crash report',
    });
    expect(details?.artifactPath).toContain('/.harness/crash-reports/');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(fs.existsSync(details!.artifactPath!)).toBe(true);
  });
});
