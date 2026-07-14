import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, resolveMetroCacheEnabled } from '../types.js';

const baseConfig = {
  entryPoint: './index.js',
  appRegistryComponentName: 'App',
  runners: [
    {
      name: 'test-runner',
      config: {},
      runner: 'test-runner',
      platformId: 'test-platform',
    },
  ],
};

describe('ConfigSchema cache group', () => {
  it('accepts a config without the cache group', () => {
    const result = ConfigSchema.parse(baseConfig);

    expect(result.cache).toBeUndefined();
    expect(result.unstable__enableMetroCache).toBeUndefined();
  });

  it('accepts cache.metro and cache.version', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      cache: { metro: false, version: 'v2' },
    });

    expect(result.cache).toEqual({ metro: false, version: 'v2' });
  });

  it('passes cache.version through untouched when metro is unset', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      cache: { version: 'salt-1' },
    });

    expect(result.cache?.metro).toBeUndefined();
    expect(result.cache?.version).toBe('salt-1');
  });

  it('rejects a non-string cache.version', () => {
    expect(() =>
      ConfigSchema.parse({ ...baseConfig, cache: { version: 2 } })
    ).toThrow();
  });
});

describe('resolveMetroCacheEnabled', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to true when neither cache.metro nor the alias is set', () => {
    expect(
      resolveMetroCacheEnabled({
        cache: undefined,
        unstable__enableMetroCache: undefined,
      })
    ).toBe(true);

    expect(
      resolveMetroCacheEnabled({
        cache: {},
        unstable__enableMetroCache: undefined,
      })
    ).toBe(true);
  });

  it('uses the deprecated alias when only it is set', () => {
    expect(
      resolveMetroCacheEnabled({
        cache: undefined,
        unstable__enableMetroCache: false,
      })
    ).toBe(false);

    expect(
      resolveMetroCacheEnabled({
        cache: undefined,
        unstable__enableMetroCache: true,
      })
    ).toBe(true);
  });

  it('logs a deprecation warning when the alias is set', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    resolveMetroCacheEnabled({
      cache: undefined,
      unstable__enableMetroCache: true,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('unstable__enableMetroCache');
  });

  it('does not log a deprecation warning when only cache.metro is set', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    resolveMetroCacheEnabled({
      cache: { metro: false },
      unstable__enableMetroCache: undefined,
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('lets explicit cache.metro win over the alias in either direction', () => {
    expect(
      resolveMetroCacheEnabled({
        cache: { metro: false },
        unstable__enableMetroCache: true,
      })
    ).toBe(false);

    expect(
      resolveMetroCacheEnabled({
        cache: { metro: true },
        unstable__enableMetroCache: false,
      })
    ).toBe(true);
  });
});
