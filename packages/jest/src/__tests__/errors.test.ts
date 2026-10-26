import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { AppBridgeDisconnectedError } from '@react-native-harness/bridge/server';
import {
  HostSurfaceReplacedError,
  NativeCrashError,
  PlatformReadyTimeoutError,
} from '../errors.js';

describe('PlatformReadyTimeoutError', () => {
  it('includes the configured timeout and config hint', () => {
    expect(new PlatformReadyTimeoutError(300000).message).toBe(
      'The platform did not become ready within 300000ms. Increase "platformReadyTimeout" if your device, simulator, or emulator needs more time to start.'
    );
  });

  it('blames a starved host instead of suggesting a larger timeout', () => {
    const error = new PlatformReadyTimeoutError(300000, {
      peakLoad1: 14.2,
      meanIdlePct: 1.6,
      minHostFreeMb: 41,
      swapoutsDeltaMb: 1200,
      cpuCount: 3,
    });

    expect(error.hostStarved).toBe(true);
    expect(error.message).toBe(
      'The platform did not become ready within 300000ms. The host was starved for resources during startup (peak load 14.2 on 3 cores, average idle 2%, min free memory 41 MB, swapped out 1200 MB). A larger "platformReadyTimeout" is unlikely to help; reduce other load on the host or use a larger machine.'
    );
  });

  it('keeps the timeout hint when only the load was high', () => {
    const error = new PlatformReadyTimeoutError(300000, {
      peakLoad1: 220,
      meanIdlePct: 40,
      minHostFreeMb: 55,
      swapoutsDeltaMb: 0,
      cpuCount: 3,
    });

    expect(error.hostStarved).toBe(false);
    expect(error.message).toContain('Increase "platformReadyTimeout"');
  });

  it('keeps the timeout hint and reports host pressure when the host was fine', () => {
    const error = new PlatformReadyTimeoutError(300000, {
      peakLoad1: 2.5,
      meanIdlePct: null,
      minHostFreeMb: 900,
      swapoutsDeltaMb: null,
      cpuCount: 3,
    });

    expect(error.hostStarved).toBe(false);
    expect(error.message).toBe(
      'The platform did not become ready within 300000ms. Increase "platformReadyTimeout" if your device, simulator, or emulator needs more time to start. Host during startup: peak load 2.5 on 3 cores, average idle n/a, min free memory 900 MB, swapped out n/a.'
    );
  });
});

describe('HostSurfaceReplacedError', () => {
  it('preserves the runtime error and identifies the interrupted file', () => {
    const cause = new Error('The native host surface was replaced.');
    cause.name = 'HostSurfaceReplacedError';
    cause.stack = 'HostSurfaceReplacedError: runtime stack';

    const error = new HostSurfaceReplacedError('/test/interrupted.ts', cause);

    expect(error.name).toBe('HostSurfaceReplacedError');
    expect(error.testFilePath).toBe('/test/interrupted.ts');
    expect(error.message).toBe(cause.message);
    expect(error.stack).toBe(cause.stack);
    expect(error.cause).toBe(cause);
  });
});

describe('NativeCrashError', () => {
  it('reports the extracted crash log path when available', () => {
    const error = new NativeCrashError('/tmp/crash.harness.ts', {
      phase: 'execution',
      artifactPath: path.join(
        process.cwd(),
        '.harness',
        'crash-reports',
        'crash.ips'
      ),
    });

    expect(error.message).toContain(
      `Harness extracted the crash log: ${path.join(
        '.harness',
        'crash-reports',
        'crash.ips'
      )}`
    );
  });

  it('lists enrichment artifact paths when available', () => {
    const error = new NativeCrashError('/tmp/crash.harness.ts', {
      phase: 'execution',
      artifactPath: path.join(
        process.cwd(),
        '.harness',
        'crash-reports',
        'logcat.txt'
      ),
      enrichmentArtifacts: [
        {
          artifactType: 'dropbox-native-crash',
          artifactPath: path.join(
            process.cwd(),
            '.harness',
            'crash-reports',
            'dropbox-native-crash.txt'
          ),
        },
      ],
    });

    expect(error.message).toContain('Additional crash artifacts:');
    expect(error.message).toContain(
      path.join('.harness', 'crash-reports', 'dropbox-native-crash.txt')
    );
  });

  it('reports crash log extraction failure when no artifact was pulled', () => {
    const error = new NativeCrashError('/tmp/crash.harness.ts', {
      phase: 'execution',
    });

    expect(error.message).toContain("Harness couldn't extract the crash log.");
  });

  it('formats the extracted stack trace in the error message', () => {
    const error = new NativeCrashError('/tmp/crash.harness.ts', {
      phase: 'execution',
      processName: 'HarnessPlayground',
      pid: 1234,
      signal: 'SIGTRAP',
      exceptionType: 'EXC_BREAKPOINT',
      stackTrace: [
        '0 AppDelegate.crashIfRequested() (AppDelegate.swift:31)',
        '1 AppDelegate.application(_:didFinishLaunchingWithOptions:) (AppDelegate.swift:56)',
      ],
    });

    expect(error.message).toContain(
      '  0 AppDelegate.crashIfRequested() (AppDelegate.swift:31)'
    );
    expect(error.message).toContain(
      '  1 AppDelegate.application(_:didFinishLaunchingWithOptions:) (AppDelegate.swift:56)'
    );
  });

  it('omits single-line iOS summaries from the rendered error message', () => {
    const error = new NativeCrashError('/tmp/crash.harness.ts', {
      phase: 'startup',
      artifactType: 'ios-crash-report',
      summary:
        '2026-03-12 13:46:18.154 Df HarnessPlayground[18007:65e716] [com.apple.dt.xctest:Default] notify_get_state check indicated test daemon not ready.',
      processName: 'HarnessPlayground',
      pid: 18007,
      signal: 'SIGABRT',
      exceptionType: 'EXC_CRASH',
    });

    expect(error.message).not.toContain(
      'notify_get_state check indicated test daemon not ready'
    );
    expect(error.message).toContain('Signal: SIGABRT');
    expect(error.message).toContain('Exception: EXC_CRASH');
    expect(error.message).toContain('Process: HarnessPlayground (pid 18007)');
  });

  it('does not duplicate stack frames when the summary already contains a crash block', () => {
    const frame =
      '03-13 07:59:44.943 20373 20373 E AndroidRuntime: \tat com.harnessplayground.MainActivity.onCreate(MainActivity.kt:38)';
    const error = new NativeCrashError('/tmp/crash.harness.ts', {
      phase: 'startup',
      summary: [
        '--------- beginning of crash',
        '03-13 07:59:44.943 20373 20373 E AndroidRuntime: FATAL EXCEPTION: main',
        frame,
      ].join('\n'),
      stackTrace: [frame],
    });

    expect(
      error.message.match(/MainActivity\.onCreate\(MainActivity\.kt:38\)/g)
    ).toHaveLength(1);
  });

  it('collapses the native crash stack header so jest does not reprint multiline messages', () => {
    const error = new NativeCrashError('/tmp/crash.harness.ts', {
      phase: 'startup',
      summary: ['line one', 'line two'].join('\n'),
    });

    expect(error.stack).toBe(
      'NativeCrashError: The native app crashed while preparing to run this test file.'
    );
  });
});

describe('AppBridgeDisconnectedError', () => {
  it('explains likely causes without exposing an internal stack', () => {
    const error = new AppBridgeDisconnectedError('app-disconnected');

    expect(error.message).toBe(
      'The app bridge disconnected during test execution. This can happen if the app was killed, crashed, reloaded, or restarted while the test file was running.'
    );
    expect(error.stack).toBe(`AppBridgeDisconnectedError: ${error.message}`);
  });

  it('uses a reconnection-specific message when a newer app connection replaces the old one', () => {
    expect(new AppBridgeDisconnectedError('app-replaced').message).toBe(
      'The app bridge was replaced by a newer app connection. This can happen when the app reloads, restarts, or reconnects while a test file is still running.'
    );
  });
});
