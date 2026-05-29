import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAndroidCrashReporter } from '../crash-reporter.js';

const javaCrashDropbox = `
========================================
2026-03-12 10:30:45.123 data_app_crash (text, 500 bytes)
Process: com.harnessplayground
PID: 7777
Package: com.harnessplayground v1 (1.0)
java.lang.RuntimeException: boom
\tat com.harnessplayground.MainActivity.onCreate(MainActivity.kt:38)
`;

const nativeCrashDropbox = `
========================================
2026-03-12 10:31:10.456 data_app_native_crash (text, 800 bytes)
Process: com.harnessplayground
PID: 8888
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0xdeadbeef
Abort message: 'JNI DETECTED ERROR IN APPLICATION'
backtrace:
      #00 pc 00001234  /data/app/lib/libapp.so
`;

describe('createAndroidCrashReporter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the current logcat crash block with the test file path', async () => {
    vi.useFakeTimers();
    const persistArtifact = vi.fn(
      () => '/tmp/.harness/crash-reports/logcat.txt'
    );
    const reporter = createAndroidCrashReporter({
      bundleId: 'com.harnessplayground',
      crashArtifactWriter: {
        runTimestamp: '2026-03-12T11-35-08-000Z',
        persistArtifact,
      },
      getLogs: () => [
        { line: 'ordinary crash-buffer line', occurredAt: 1_000 },
        { line: '--------- beginning of crash', occurredAt: 1_100 },
        {
          line: 'Process: com.harnessplayground, PID: 7777',
          occurredAt: 1_100,
        },
        { line: 'FATAL EXCEPTION: main', occurredAt: 1_100 },
      ],
    });

    const detailsPromise = reporter.getCrashDetails({
      occurredAt: 1_100,
      pid: 7777,
      testFilePath: '/test/native-crash.test.ts',
    });
    await vi.advanceTimersByTimeAsync(100);
    const details = await detailsPromise;

    expect(details).toMatchObject({
      artifactType: 'logcat',
      artifactPath: '/tmp/.harness/crash-reports/logcat.txt',
      pid: 7777,
      processName: 'com.harnessplayground',
    });
    expect(persistArtifact).toHaveBeenCalledWith({
      artifactKind: 'logcat',
      testFilePath: '/test/native-crash.test.ts',
      source: {
        kind: 'text',
        fileName: 'logcat.txt',
        text: [
          '--------- beginning of crash',
          'Process: com.harnessplayground, PID: 7777',
          'FATAL EXCEPTION: main',
          '',
        ].join('\n'),
      },
    });
  });

  it('adds dropbox artifacts as enrichment when logcat evidence is available', async () => {
    vi.useFakeTimers();
    const persistArtifact = vi
      .fn()
      .mockImplementation(({ artifactKind }: { artifactKind: string }) => {
        return `/tmp/.harness/crash-reports/${artifactKind}.txt`;
      });
    const reporter = createAndroidCrashReporter({
      bundleId: 'com.harnessplayground',
      crashArtifactWriter: {
        runTimestamp: '2026-03-12T11-35-08-000Z',
        persistArtifact,
      },
      getLogs: () => [
        { line: '--------- beginning of crash', occurredAt: 1_100 },
        {
          line: 'Process: com.harnessplayground, PID: 7777',
          occurredAt: 1_100,
        },
        { line: 'FATAL EXCEPTION: main', occurredAt: 1_100 },
      ],
      getDropboxOutput: async () => javaCrashDropbox,
      getExitInfo: async () =>
        'ApplicationExitInfo #0:\n  package=com.harnessplayground pid=7777 reason=4 (APP CRASH(NATIVE))',
    });

    const detailsPromise = reporter.getCrashDetails({
      occurredAt: 1_100,
      pid: 7777,
      testFilePath: '/test/native-crash.test.ts',
    });
    await vi.advanceTimersByTimeAsync(100);
    const details = await detailsPromise;

    expect(details).toMatchObject({
      artifactType: 'logcat',
      artifactPath: '/tmp/.harness/crash-reports/logcat.txt',
    });
    expect(details?.enrichmentArtifacts).toEqual(
      expect.arrayContaining([
        {
          artifactType: 'dropbox-crash',
          artifactPath: '/tmp/.harness/crash-reports/dropbox-crash.txt',
        },
        {
          artifactType: 'exit-info',
          artifactPath: '/tmp/.harness/crash-reports/exit-info.txt',
        },
      ])
    );
  });

  it('falls back to native dropbox evidence when logcat is empty', async () => {
    vi.useFakeTimers();
    const persistArtifact = vi
      .fn()
      .mockImplementation(({ artifactKind }: { artifactKind: string }) => {
        return `/tmp/.harness/crash-reports/${artifactKind}.txt`;
      });
    const reporter = createAndroidCrashReporter({
      bundleId: 'com.harnessplayground',
      crashArtifactWriter: {
        runTimestamp: '2026-03-12T11-35-08-000Z',
        persistArtifact,
      },
      getLogs: () => [],
      getDropboxOutput: async () => nativeCrashDropbox,
    });

    const detailsPromise = reporter.getCrashDetails({
      occurredAt: 1_100,
      pid: 8888,
      testFilePath: '/test/native-crash.test.ts',
    });
    await vi.advanceTimersByTimeAsync(100);
    const details = await detailsPromise;

    expect(details).toMatchObject({
      artifactType: 'dropbox-native-crash',
      artifactPath: '/tmp/.harness/crash-reports/dropbox-native-crash.txt',
      pid: 8888,
      signal: 'SIGSEGV',
      processName: 'com.harnessplayground',
    });
  });
});
