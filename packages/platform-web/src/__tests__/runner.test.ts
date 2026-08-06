import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import type { WebPlatformConfig } from '../config.js';

const closeMock = vi.fn().mockResolvedValue(undefined);
const exposeFunctionMock = vi.fn().mockResolvedValue(undefined);
const gotoMock = vi.fn().mockResolvedValue(undefined);
const pageOnMock = vi.fn();

const launchMock = vi.fn().mockResolvedValue({
  close: closeMock,
  newContext: vi.fn().mockResolvedValue({
    newPage: vi.fn().mockResolvedValue({
      exposeFunction: exposeFunctionMock,
      goto: gotoMock,
      on: pageOnMock,
    }),
  }),
});

vi.mock('playwright', () => ({
  chromium: { launch: launchMock },
  firefox: { launch: launchMock },
  webkit: { launch: launchMock },
}));

const harnessConfig = { metroPort: DEFAULT_METRO_PORT } as HarnessConfig;

const config: WebPlatformConfig = {
  name: 'web',
  browser: {
    type: 'chromium',
    url: 'http://localhost:8081',
    headless: true,
  },
};

describe('getWebRunner', () => {
  it('is invoked with the (config, harnessConfig, init) shape the harness session uses', async () => {
    // Regression test for the bug where the session called
    // module.default(config, runtimeConfig, init), but this runner declared
    // only (config, init?) — so runtimeConfig landed in the init slot and
    // init.signal.aborted threw. Asserting the arity here catches an
    // optional-parameter regression, since optional params drop out of
    // Function.length.
    const { default: getWebRunner } = await import('../runner.js');
    expect(getWebRunner.length).toBe(3);

    const init = { signal: new AbortController().signal };
    const runner = await getWebRunner(config, harnessConfig, init);
    expect(runner.createAppSession).toBeTypeOf('function');
    expect(runner.dispose).toBeTypeOf('function');
  });

  it('does not throw when the init signal is already aborted', async () => {
    // This is the exact failure mode from the reported bug: with the wrong
    // argument order, `init` ended up holding runtimeConfig, and
    // `init.signal.aborted` threw `TypeError: Cannot read properties of
    // undefined (reading 'aborted')`.
    const { default: getWebRunner } = await import('../runner.js');
    const controller = new AbortController();
    controller.abort();

    const runner = await getWebRunner(config, harnessConfig, {
      signal: controller.signal,
    });
    const session = await runner.createAppSession();

    expect(session.dispose).toBeTypeOf('function');
  });

  it('does not close the browser when the init signal aborts after session creation', async () => {
    const { default: getWebRunner } = await import('../runner.js');
    const controller = new AbortController();

    const runner = await getWebRunner(config, harnessConfig, {
      signal: controller.signal,
    });
    await runner.createAppSession();
    closeMock.mockClear();

    controller.abort();

    expect(closeMock).not.toHaveBeenCalled();
    await runner.dispose();
    expect(closeMock).toHaveBeenCalledOnce();
  });
});
