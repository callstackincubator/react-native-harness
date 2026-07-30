import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import type { VegaPlatformConfig } from '../config.js';

const stopAppMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../kepler.js', () => ({
  getVegaDeviceStatus: vi.fn().mockResolvedValue('running'),
  isAppInstalled: vi.fn().mockResolvedValue(true),
  isAppRunning: vi.fn().mockResolvedValue(false),
  startApp: vi.fn().mockResolvedValue(undefined),
  stopApp: stopAppMock,
}));

const harnessConfig = { metroPort: DEFAULT_METRO_PORT } as HarnessConfig;

const config: VegaPlatformConfig = {
  name: 'vega',
  device: { type: 'emulator', deviceId: 'VegaTV_1' },
  bundleId: 'com.example.app',
};

describe('getVegaRunner', () => {
  it('is invoked with the (config, harnessConfig, init) shape the harness session uses', async () => {
    // Regression test for the bug where the session called
    // module.default(config, runtimeConfig, init), but this runner declared
    // only (config, init?) — so runtimeConfig landed in the init slot and
    // init.signal.aborted threw. Asserting the arity here catches an
    // optional-parameter regression, since optional params drop out of
    // Function.length.
    const { default: getVegaRunner } = await import('../runner.js');
    expect(getVegaRunner.length).toBe(3);

    const init = { signal: new AbortController().signal };
    const runner = await getVegaRunner(config, harnessConfig, init);
    expect(runner.createAppSession).toBeTypeOf('function');
    expect(runner.dispose).toBeTypeOf('function');
  });

  it('stops the app when the init signal aborts after session creation', async () => {
    const { default: getVegaRunner } = await import('../runner.js');
    const controller = new AbortController();

    const runner = await getVegaRunner(config, harnessConfig, {
      signal: controller.signal,
    });
    await runner.createAppSession();
    stopAppMock.mockClear();

    controller.abort();

    expect(stopAppMock).toHaveBeenCalled();
  });
});
