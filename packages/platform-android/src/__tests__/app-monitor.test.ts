import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeCrashError } from '@react-native-harness/platforms';
import type { Subprocess } from '@react-native-harness/tools';
import { createAndroidAppMonitor, createAndroidLogEvent } from '../app-monitor.js';
import * as adb from '../adb.js';

const createStreamingSubprocess = (
  chunks: Array<{ line: string; delayMs?: number }>,
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

describe('createAndroidLogEvent', () => {
  it('detects confirmation-grade am_crash events', () => {
    const event = createAndroidLogEvent(
      '05-20 12:00:00.200  1000  1000 I am_crash: [0,1234,com.harnessplayground,123,java.lang.IllegalStateException,boom]',
      'com.harnessplayground',
    );

    expect(event).toMatchObject({
      type: 'crash_confirmed',
      crashDetails: {
        platform: 'android',
        kind: 'java-exception',
        confidence: 'high',
        source: 'logs',
      },
    });
  });
});

describe('createAndroidAppMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue('05-20 12:00:00.000');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts logcat with crash, main, system, and events buffers', async () => {
    const startLogcat = vi
      .spyOn(adb, 'startLogcat')
      .mockReturnValue(createStreamingSubprocess([]));

    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
      isAppRunning: async () => true,
    });

    await monitor.start();
    await monitor.stop();

    expect(startLogcat).toHaveBeenCalledWith('emulator-5554', [
      'logcat',
      '-b',
      'crash',
      '-b',
      'main',
      '-b',
      'system',
      '-b',
      'events',
      '-v',
      'threadtime',
      '-T',
      '05-20 12:00:00.000',
    ]);
  });

  it('rejects the watch for Java crashes when am_crash arrives even if the process still looks alive', async () => {
    vi.spyOn(adb, 'startLogcat').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '05-20 12:00:00.000  1234  1234 I ActivityManager: Start proc 1234:com.harnessplayground/u0a123 for activity',
        },
        {
          line: '05-20 12:00:00.100  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main',
        },
        {
          line: '05-20 12:00:00.101  1234  1234 E AndroidRuntime: Process: com.harnessplayground, PID: 1234',
        },
        {
          line: '05-20 12:00:00.102  1234  1234 E AndroidRuntime: java.lang.IllegalStateException: Intentional pre-RN startup crash',
        },
        {
          line: '05-20 12:00:00.103  1234  1234 E AndroidRuntime:     at com.harnessplayground.MainActivity.onCreate(MainActivity.kt:42)',
        },
        {
          line: '05-20 12:00:00.200  1000  1000 I am_crash: [0,1234,com.harnessplayground,123,java.lang.IllegalStateException,Intentional pre-RN startup crash]',
        },
      ]),
    );

    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
      isAppRunning: async () => true,
    });
    const crashWatch = monitor.watch('example.test.ts', 'startup');
    crashWatch.promise.catch(() => undefined);

    await monitor.start();
    await vi.advanceTimersByTimeAsync(100);

    await expect(crashWatch.promise).rejects.toMatchObject({
      testFilePath: 'example.test.ts',
      details: {
        phase: 'startup',
        platform: 'android',
        kind: 'java-exception',
        confidence: 'high',
        processName: 'com.harnessplayground',
        pid: 1234,
        exceptionType: 'java.lang.IllegalStateException: Intentional pre-RN startup crash',
      },
    });
    await expect(crashWatch.promise).rejects.toBeInstanceOf(NativeCrashError);

    await monitor.stop();
  });

  it('rejects the watch when a suspected crash is followed by process exit', async () => {
    vi.spyOn(adb, 'startLogcat').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '05-20 12:00:00.101  1234  1234 E AndroidRuntime: Process: com.harnessplayground, PID: 1234',
        },
        {
          line: '05-20 12:00:00.102  1234  1234 E AndroidRuntime: java.lang.IllegalStateException: Intentional delayed startup crash',
        },
      ]),
    );

    const isAppRunning = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false);
    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
      isAppRunning,
    });
    const crashWatch = monitor.watch('example.test.ts', 'execution');
    crashWatch.promise.catch(() => undefined);

    await monitor.start();
    await vi.advanceTimersByTimeAsync(350);

    await expect(crashWatch.promise).rejects.toMatchObject({
      details: {
        phase: 'execution',
        platform: 'android',
        kind: 'java-exception',
        processName: 'com.harnessplayground',
        pid: 1234,
      },
    });

    await monitor.stop();
  });

  it('does not reject the watch when the process exits without a recent crash signal', async () => {
    vi.spyOn(adb, 'startLogcat').mockReturnValue(createStreamingSubprocess([]));

    const isAppRunning = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false);
    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
      isAppRunning,
    });
    const crashWatch = monitor.watch('example.test.ts', 'execution');
    let settled = false;

    const watchHandled = crashWatch.promise.catch(() => {
      settled = true;
    });

    await monitor.start();
    await vi.advanceTimersByTimeAsync(600);

    expect(settled).toBe(false);

    crashWatch.cancel();
    await monitor.stop();
    await watchHandled;
  });

  it('suppresses process-exit confirmation during a controlled stop window', async () => {
    vi.spyOn(adb, 'startLogcat').mockReturnValue(
      createStreamingSubprocess([
        {
          line: '05-20 12:00:00.101  1234  1234 E AndroidRuntime: Process: com.harnessplayground, PID: 1234',
        },
      ]),
    );

    const isAppRunning = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false);
    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
      isAppRunning,
    });
    const crashWatch = monitor.watch('example.test.ts', 'execution');
    let settled = false;

    const watchHandled = crashWatch.promise.catch(() => {
      settled = true;
    });

    await monitor.start();
    monitor.stopRequested({
      type: 'stop_requested',
      at: Date.now(),
      reason: 'manual',
    });
    await vi.advanceTimersByTimeAsync(400);

    expect(settled).toBe(false);

    crashWatch.cancel();
    await monitor.stop();
    await watchHandled;
  });
});
