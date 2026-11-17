import { describe, expect, it, vi } from 'vitest';
import { getEmitter } from '@react-native-harness/tools';
import type {
  BundlerEvent,
  BundlerFactoryOptions,
} from '@react-native-harness/bundlers';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { Reporter, ReportableEvent } from '../reporter.js';

const mocks = vi.hoisted(() => ({
  getMetroInstance: vi.fn(),
}));

vi.mock('../factory.js', () => ({
  getMetroInstance: mocks.getMetroInstance,
}));

const createMetroInstance = () => {
  const events: Reporter = getEmitter<ReportableEvent>();
  return {
    events,
    httpServer: {},
    websocketEndpoints: {},
    waitUntilHealthy: vi.fn(async () => ({
      healthy: true,
      status: 'HTTP 200: packager-status:running',
    })),
    prewarm: vi.fn(async () => true),
    getPrewarmState: vi.fn(() => 'succeeded' as const),
    isBuildInFlight: vi.fn(() => false),
    dispose: vi.fn(async () => undefined),
  };
};

const platform = {
  name: 'ios',
  platformId: 'ios',
  config: { device: 'x' },
  runner: 'file:///runner.js',
  metroConfigEnhancer: 'file:///enhancer.js',
} as BundlerFactoryOptions<unknown, unknown>['platform'];

const createOptions = () => ({
  config: {},
  projectRoot: '/project',
  harnessConfig: { metroPort: 8081 } as HarnessConfig,
  websocketEndpoints: {},
  platform,
  watchMode: true,
});

describe('metro bundler module', () => {
  it('describes Metro with a module that resolves to this bundler', async () => {
    const { metroBundler } = await import('../metro-bundler.js');

    expect(metroBundler()).toEqual({
      name: 'metro',
      displayName: 'Metro',
      module: expect.stringMatching(/\/bundler\.js$/),
      config: {},
    });
  });

  it('creates the Metro instance from the neutral options', async () => {
    const metro = createMetroInstance();
    mocks.getMetroInstance.mockResolvedValue(metro);
    const signal = new AbortController().signal;
    const { default: createMetroBundler } = await import('../bundler.js');

    await createMetroBundler(createOptions(), signal);

    expect(mocks.getMetroInstance).toHaveBeenCalledWith(
      {
        projectRoot: '/project',
        harnessConfig: { metroPort: 8081 },
        metroConfigEnhancer: 'file:///enhancer.js',
        platformId: 'ios',
        platformConfig: { device: 'x' },
        websocketEndpoints: {},
        watchMode: true,
      },
      signal
    );
  });

  it('forwards Metro events as neutral events until disposed', async () => {
    const metro = createMetroInstance();
    mocks.getMetroInstance.mockResolvedValue(metro);
    const { default: createMetroBundler } = await import('../bundler.js');
    const bundler = await createMetroBundler(
      createOptions(),
      new AbortController().signal
    );
    const received: BundlerEvent[] = [];
    bundler.events.addListener((event) => received.push(event));

    metro.events.emit({ type: 'bundle_build_done', buildID: 'b' });
    metro.events.emit({ type: 'initialize_done' });
    await bundler.dispose();
    metro.events.emit({ type: 'bundle_build_done', buildID: 'c' });

    expect(received).toEqual([{ type: 'build_done', buildId: 'b' }]);
    expect(metro.dispose).toHaveBeenCalledOnce();
  });

  it('passes the Metro health result straight through', async () => {
    const metro = createMetroInstance();
    const unhealthy = { healthy: false, status: 'connect ECONNREFUSED' };
    metro.waitUntilHealthy.mockResolvedValueOnce(unhealthy);
    mocks.getMetroInstance.mockResolvedValue(metro);
    const { default: createMetroBundler } = await import('../bundler.js');
    const bundler = await createMetroBundler(
      createOptions(),
      new AbortController().signal
    );

    await expect(
      bundler.waitUntilHealthy({
        timeoutMs: 1,
        signal: new AbortController().signal,
      })
    ).resolves.toBe(unhealthy);
  });

  it('delegates health, prewarm and build state to the Metro instance', async () => {
    const metro = createMetroInstance();
    mocks.getMetroInstance.mockResolvedValue(metro);
    const { default: createMetroBundler } = await import('../bundler.js');
    const bundler = await createMetroBundler(
      createOptions(),
      new AbortController().signal
    );
    const signal = new AbortController().signal;

    await expect(bundler.prewarm({ platform: 'ios', signal })).resolves.toBe(
      true
    );
    expect(metro.prewarm).toHaveBeenCalledWith({ platform: 'ios', signal });
    expect(bundler.getPrewarmState()).toBe('succeeded');
    expect(bundler.isBuildInFlight()).toBe(false);
    await expect(
      bundler.waitUntilHealthy({ timeoutMs: 1, signal })
    ).resolves.toEqual({
      healthy: true,
      status: 'HTTP 200: packager-status:running',
    });
  });
});
