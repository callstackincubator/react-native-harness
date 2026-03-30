import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { HarnessPlatform } from '@react-native-harness/platforms';

const mocks = vi.hoisted(() => ({
  isMetroCacheReusable: vi.fn(),
  logMetroCacheReused: vi.fn(),
  logMetroPrewarmCompleted: vi.fn(),
}));

vi.mock('@react-native-harness/bundler-metro', () => ({
  isMetroCacheReusable: mocks.isMetroCacheReusable,
}));

vi.mock('../logs.js', () => ({
  logMetroCacheReused: mocks.logMetroCacheReused,
  logMetroPrewarmCompleted: mocks.logMetroPrewarmCompleted,
}));

import { maybeLogMetroCacheReuse } from '../harness.js';

const platform: HarnessPlatform = {
  name: 'ios',
  platformId: 'ios',
  runner: '/virtual/platform-runner.js',
  config: {},
};

const createHarnessConfig = (
  overrides: Partial<HarnessConfig> = {}
): HarnessConfig =>
  ({
    appRegistryComponentName: 'App',
    disableViewFlattening: false,
    bridgeTimeout: 5000,
    entryPoint: 'index.js',
    unstable__enableMetroCache: true,
    forwardClientLogs: false,
    ...overrides,
  }) as HarnessConfig;

describe('maybeLogMetroCacheReuse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMetroCacheReusable.mockReturnValue(false);
  });

  it('logs when an existing metro cache will be reused', () => {
    mocks.isMetroCacheReusable.mockReturnValue(true);

    maybeLogMetroCacheReuse(createHarnessConfig(), platform, '/tmp/project');

    expect(mocks.isMetroCacheReusable).toHaveBeenCalledWith('/tmp/project');
    expect(mocks.logMetroCacheReused).toHaveBeenCalledWith(platform);
  });

  it('does not log when metro cache reuse is disabled', () => {
    maybeLogMetroCacheReuse(
      createHarnessConfig({ unstable__enableMetroCache: false }),
      platform,
      '/tmp/project'
    );

    expect(mocks.isMetroCacheReusable).not.toHaveBeenCalled();
    expect(mocks.logMetroCacheReused).not.toHaveBeenCalled();
  });

  it('does not log when the metro cache is absent', () => {
    maybeLogMetroCacheReuse(createHarnessConfig(), platform, '/tmp/project');

    expect(mocks.logMetroCacheReused).not.toHaveBeenCalled();
  });
});
