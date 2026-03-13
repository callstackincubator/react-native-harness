import { describe, expect, it } from 'vitest';
import { NativeCrashError } from '../errors.js';

describe('NativeCrashError', () => {
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

    expect(error.message).not.toContain('notify_get_state check indicated test daemon not ready');
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

    expect(error.message.match(/MainActivity\.onCreate\(MainActivity\.kt:38\)/g)).toHaveLength(
      1
    );
  });

  it('collapses the native crash stack header so jest does not reprint multiline messages', () => {
    const error = new NativeCrashError('/tmp/crash.harness.ts', {
      phase: 'startup',
      summary: ['line one', 'line two'].join('\n'),
    });

    expect(error.stack).toBe('NativeCrashError: The native app crashed while preparing to run this test file.');
  });
});
