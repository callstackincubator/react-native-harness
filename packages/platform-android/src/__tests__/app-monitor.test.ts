import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAndroidAppMonitor, createAndroidLogEvent } from '../app-monitor.js';
import * as tools from '@react-native-harness/tools';
import { createCrashArtifactWriter } from '@react-native-harness/tools';

const createMockSubprocess = (): tools.Subprocess =>
  ({
    nodeChildProcess: Promise.resolve({
      kill: vi.fn(),
    }),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    [Symbol.asyncIterator]: async function* () {},
  }) as unknown as tools.Subprocess;

const createStreamingSubprocess = (
  chunks: Array<{ line: string; delayMs?: number }>
): tools.Subprocess =>
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
  }) as unknown as tools.Subprocess;

const artifactRoot = fs.mkdtempSync(
  path.join(tmpdir(), 'rn-harness-android-monitor-artifacts-')
);

afterEach(() => {
  fs.rmSync(artifactRoot, { recursive: true, force: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
});

describe('createAndroidLogEvent', () => {
  it('extracts crash details from fatal signal log lines', () => {
    const event = createAndroidLogEvent(
      '03-12 11:35:08.000  1234  1234 F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR) in tid 1234 (com.harnessplayground), pid 1234 (com.harnessplayground)',
      'com.harnessplayground'
    );

    expect(event).toMatchObject({
      type: 'possible_crash',
      source: 'logs',
      crashDetails: {
        source: 'logs',
        signal: 'SIGSEGV',
        summary:
          '03-12 11:35:08.000  1234  1234 F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR) in tid 1234 (com.harnessplayground), pid 1234 (com.harnessplayground)',
      },
    });
  });

  it('extracts process and pid when AndroidRuntime reports a crash', () => {
    const event = createAndroidLogEvent(
      '03-12 11:35:09.000  1234  1234 E AndroidRuntime: Process: com.harnessplayground, PID: 1234',
      'com.harnessplayground'
    );

    expect(event).toMatchObject({
      type: 'possible_crash',
      pid: 1234,
      crashDetails: {
        processName: 'com.harnessplayground',
        pid: 1234,
      },
    });
  });

  it('starts logcat from the current device timestamp', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn');

    spawnSpy.mockImplementation(
      ((file: string, args?: readonly string[]) => {
        if (file === 'adb' && args?.includes('date')) {
          return {
            stdout: '03-12 11:35:08.000\n',
          } as Awaited<ReturnType<typeof tools.spawn>>;
        }

        return createMockSubprocess();
      }) as typeof tools.spawn
    );

    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
    });

    await monitor.start();
    await monitor.stop();

    expect(spawnSpy).toHaveBeenNthCalledWith(2, 'adb', [
      '-s',
      'emulator-5554',
      'logcat',
      '-v',
      'threadtime',
      '-b',
      'crash',
      '--uid=10234',
      '-T',
      '03-12 11:35:08.000',
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
  });

  it('hydrates crash details with stack lines that arrive after the first crash event', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn');

    spawnSpy.mockImplementation(
      ((file: string, args?: readonly string[]) => {
        if (file === 'adb' && args?.includes('date')) {
          return {
            stdout: '03-12 10:44:40.000\n',
          } as Awaited<ReturnType<typeof tools.spawn>>;
        }

        return createStreamingSubprocess([
          { line: '--------- beginning of crash' },
          {
            line: '03-12 10:44:40.420 13861 13861 E AndroidRuntime: Process: com.harnessplayground, PID: 13861',
          },
          {
            line: '03-12 10:44:40.421 13861 13861 E AndroidRuntime: java.lang.RuntimeException: boom',
            delayMs: 25,
          },
          {
            line: '03-12 10:44:40.422 13861 13861 E AndroidRuntime:     at com.harnessplayground.MainActivity.onCreate(MainActivity.kt:42)',
            delayMs: 25,
          },
        ]);
      }) as typeof tools.spawn
    );

    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
    });

    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const details = await monitor.getCrashDetails({
      pid: 13861,
      occurredAt: Date.now(),
    });

    await monitor.stop();

    expect(details?.rawLines).toEqual([
      '--------- beginning of crash',
      '03-12 10:44:40.420 13861 13861 E AndroidRuntime: Process: com.harnessplayground, PID: 13861',
      '03-12 10:44:40.421 13861 13861 E AndroidRuntime: java.lang.RuntimeException: boom',
      '03-12 10:44:40.422 13861 13861 E AndroidRuntime:     at com.harnessplayground.MainActivity.onCreate(MainActivity.kt:42)',
    ]);
  });

  it('persists resolved Android crash blocks into .harness', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn');

    spawnSpy.mockImplementation(
      ((file: string, args?: readonly string[]) => {
        if (file === 'adb' && args?.includes('date')) {
          return {
            stdout: '03-12 10:44:40.000\n',
          } as Awaited<ReturnType<typeof tools.spawn>>;
        }

        return createStreamingSubprocess([
          { line: '--------- beginning of crash' },
          {
            line: '03-12 10:44:40.420 13861 13861 E AndroidRuntime: Process: com.harnessplayground, PID: 13861',
          },
          {
            line: '03-12 10:44:40.421 13861 13861 E AndroidRuntime: java.lang.RuntimeException: boom',
            delayMs: 20,
          },
        ]);
      }) as typeof tools.spawn
    );

    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
      crashArtifactWriter: createCrashArtifactWriter({
        runnerName: 'android',
        platformId: 'android',
        rootDir: path.join(artifactRoot, '.harness', 'crash-reports'),
        runTimestamp: '2026-03-12T11-35-08-000Z',
      }),
    });

    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const details = await monitor.getCrashDetails({
      pid: 13861,
      occurredAt: Date.now(),
    });

    await monitor.stop();

    expect(details?.artifactPath).toContain('/.harness/crash-reports/');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(fs.readFileSync(details!.artifactPath!, 'utf8')).toContain(
      'RuntimeException: boom'
    );
  });

  it('can be started again after timestamp lookup fails', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn');
    const timestampError = new Error('date failed');

    spawnSpy.mockImplementation(
      ((file: string, args?: readonly string[]) => {
        if (file === 'adb' && args?.includes('date')) {
          if (
            spawnSpy.mock.calls.filter(
              ([calledFile, calledArgs]) =>
                calledFile === 'adb' &&
                Array.isArray(calledArgs) &&
                calledArgs.includes('date')
            ).length === 1
          ) {
            throw timestampError;
          }

          return {
            stdout: '03-12 11:35:08.000\n',
          } as Awaited<ReturnType<typeof tools.spawn>>;
        }

        return createMockSubprocess();
      }) as typeof tools.spawn
    );

    const monitor = createAndroidAppMonitor({
      adbId: 'emulator-5554',
      bundleId: 'com.harnessplayground',
      appUid: 10234,
    });

    await expect(monitor.start()).rejects.toThrow(timestampError);
    await expect(monitor.start()).resolves.toBeUndefined();
    await monitor.stop();

    expect(
      spawnSpy.mock.calls.some(
        ([file, args]) =>
          file === 'adb' &&
          Array.isArray(args) &&
          args.includes('logcat') &&
          args.includes('--uid=10234')
      )
    ).toBe(true);
  });
});
