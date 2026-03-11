import { describe, expect, it } from 'vitest';
import { androidCrashParser } from '../crash-parser.js';

describe('androidCrashParser.parse', () => {
  it('parses an AndroidRuntime crash block into a crash details object', () => {
    expect(
      androidCrashParser.parse({
        contents: [
          '--------- beginning of crash',
          '03-12 11:35:09.000  1234  1234 E AndroidRuntime: Process: com.harnessplayground, PID: 1234',
          '03-12 11:35:09.001  1234  1234 E AndroidRuntime: java.lang.RuntimeException: boom',
          '03-12 11:35:09.002  1234  1234 E AndroidRuntime:     at com.harnessplayground.MainActivity.onCreate(MainActivity.kt:42)',
        ].join('\n'),
        bundleId: 'com.harnessplayground',
      })
    ).toEqual({
      source: 'logs',
      summary: [
        '--------- beginning of crash',
        '03-12 11:35:09.000  1234  1234 E AndroidRuntime: Process: com.harnessplayground, PID: 1234',
        '03-12 11:35:09.001  1234  1234 E AndroidRuntime: java.lang.RuntimeException: boom',
        '03-12 11:35:09.002  1234  1234 E AndroidRuntime:     at com.harnessplayground.MainActivity.onCreate(MainActivity.kt:42)',
      ].join('\n'),
      signal: undefined,
      exceptionType: 'java.lang.RuntimeException: boom',
      processName: 'com.harnessplayground',
      pid: 1234,
      rawLines: [
        '--------- beginning of crash',
        '03-12 11:35:09.000  1234  1234 E AndroidRuntime: Process: com.harnessplayground, PID: 1234',
        '03-12 11:35:09.001  1234  1234 E AndroidRuntime: java.lang.RuntimeException: boom',
        '03-12 11:35:09.002  1234  1234 E AndroidRuntime:     at com.harnessplayground.MainActivity.onCreate(MainActivity.kt:42)',
      ],
      stackTrace: [
        '03-12 11:35:09.002  1234  1234 E AndroidRuntime:     at com.harnessplayground.MainActivity.onCreate(MainActivity.kt:42)',
      ],
    });
  });

  it('extracts fatal signals from a native crash block', () => {
    expect(
      androidCrashParser.parse({
        contents:
          '03-12 11:35:08.000  1234  1234 F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR) in tid 1234 (com.harnessplayground), pid 1234 (com.harnessplayground)',
        bundleId: 'com.harnessplayground',
      })
    ).toMatchObject({
      signal: 'SIGSEGV',
      processName: 'com.harnessplayground',
    });
  });
});
