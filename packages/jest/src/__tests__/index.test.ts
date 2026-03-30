import { describe, expect, it, vi } from 'vitest';
import type { Harness } from '../harness.js';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { Test } from 'jest-runner';
import JestHarness from '../index.js';
import { StartupStallError } from '../errors.js';

describe('JestHarness', () => {
  it('reports StartupStallError without a stack trace', async () => {
    const runner = new JestHarness({} as any);
    const onFailure = vi.fn();

    const harness = {
      ensureAppReady: vi
        .fn()
        .mockRejectedValue(new StartupStallError(1500, 3)),
      callHook: vi.fn(async () => undefined),
      setRunState: vi.fn(),
      getRunState: vi.fn(() => null),
      crashSupervisor: {
        beginTestRun: vi.fn(),
        waitForCrash: vi.fn(),
        cancelCrashWaiters: vi.fn(),
        reset: vi.fn(),
      },
    } as unknown as Harness;

    await runner._createInBandTestRun(
      [
        {
          path: '/tmp/example.harness.ts',
          context: {
            config: {},
          },
        } as Test,
      ],
      {
        isInterrupted: () => false,
      } as any,
      harness,
      {
        detectNativeCrashes: true,
        resetEnvironmentBetweenTestFiles: false,
      } as HarnessConfig,
      () => Promise.resolve(),
      () => Promise.resolve(),
      onFailure
    );

    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/tmp/example.harness.ts',
      }),
      {
        message:
          'The app never became ready after 3 launch attempts with a startup stall timeout of 1500ms and no native crash signal.',
        stack: '',
      }
    );
  });
});
