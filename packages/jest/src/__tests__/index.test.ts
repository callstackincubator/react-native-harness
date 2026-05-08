import { describe, expect, it, vi } from 'vitest';
import type { HarnessSession } from '../harness-session.js';
import type { Config, Test, TestWatcher } from 'jest-runner';
import { StartupStallError } from '../errors.js';
import { executeRun } from '../execute-run.js';

const makeSession = (overrides: Partial<HarnessSession> = {}): HarnessSession => ({
  config: {
    detectNativeCrashes: true,
    resetEnvironmentBetweenTestFiles: false,
    metroPort: 8081,
  } as HarnessSession['config'],
  context: { platform: {} } as HarnessSession['context'],
  ensureAppReady: vi.fn().mockResolvedValue(undefined),
  runTestFile: vi.fn().mockResolvedValue({}),
  restartApp: vi.fn().mockResolvedValue(undefined),
  resetCrashState: vi.fn(),
  callHook: vi.fn().mockResolvedValue(undefined),
  setRunState: vi.fn(),
  dispose: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('executeRun', () => {
  it('reports StartupStallError without a stack trace', async () => {
    const onFailure = vi.fn();
    const session = makeSession({
      ensureAppReady: vi.fn().mockRejectedValue(new StartupStallError(1500, 3)),
    });

    await executeRun(
      session,
      [
        {
          path: '/tmp/example.harness.ts',
          context: { config: {} },
        } as Test,
      ],
      { isInterrupted: () => false } as TestWatcher,
      () => Promise.resolve(),
      () => Promise.resolve(),
      onFailure,
      {} as Config.GlobalConfig,
    );

    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/example.harness.ts' }),
      {
        message:
          'The app did not request its Metro bundle after 3 launch attempts within 1500ms. Last Metro status: unknown.',
        stack: '',
      },
    );
  });
});
