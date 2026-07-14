import type { HarnessPlatform } from '@react-native-harness/platforms';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maybeLogMetroCacheReused } from '../harness-session.js';

const { createHarnessCache, isWarm, logMetroCacheReused } = vi.hoisted(() => {
  const isWarm = vi.fn();

  return {
    isWarm,
    createHarnessCache: vi.fn((options: { projectRoot: string }) => ({
      paths: {
        root: `${options.projectRoot}/.harness/cache`,
        metroTransform: `${options.projectRoot}/.harness/cache/metro`,
        metroFileMap: `${options.projectRoot}/.harness/cache/metro-file-map`,
      },
      isWarm,
      ensureDomainDirectories: vi.fn(),
    })),
    logMetroCacheReused: vi.fn(),
  };
});

vi.mock('@react-native-harness/cache', () => ({
  createHarnessCache,
}));

vi.mock('../logs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../logs.js')>()),
  logMetroCacheReused,
}));

const platform = { name: 'test-runner' } as HarnessPlatform;

describe('maybeLogMetroCacheReused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the reuse message when caching is enabled and the cache is warm', () => {
    isWarm.mockReturnValue(true);

    maybeLogMetroCacheReused({
      config: { cache: { metro: true } },
      projectRoot: '/tmp/app',
      platform,
    });

    expect(createHarnessCache).toHaveBeenCalledWith({
      projectRoot: '/tmp/app',
    });
    expect(isWarm).toHaveBeenCalledWith('metro');
    expect(logMetroCacheReused).toHaveBeenCalledWith(platform);
  });

  it('logs the reuse message with a warm cache when caching is on by default', () => {
    isWarm.mockReturnValue(true);

    maybeLogMetroCacheReused({
      config: {},
      projectRoot: '/tmp/app',
      platform,
    });

    expect(logMetroCacheReused).toHaveBeenCalledWith(platform);
  });

  it('does not log when caching is enabled but the cache is cold', () => {
    isWarm.mockReturnValue(false);

    maybeLogMetroCacheReused({
      config: { cache: { metro: true } },
      projectRoot: '/tmp/app',
      platform,
    });

    expect(logMetroCacheReused).not.toHaveBeenCalled();
  });

  it('does not log when caching is disabled, regardless of cache state', () => {
    isWarm.mockReturnValue(true);

    maybeLogMetroCacheReused({
      config: { cache: { metro: false } },
      projectRoot: '/tmp/app',
      platform,
    });

    expect(createHarnessCache).not.toHaveBeenCalled();
    expect(logMetroCacheReused).not.toHaveBeenCalled();
  });
});
