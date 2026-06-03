import { describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { HarnessPlatform } from '@react-native-harness/platforms';
import { resolveHarnessMetroPort } from '../metro-port.js';

const mocks = vi.hoisted(() => ({
  isPortAvailable: vi.fn(async () => true),
}));

vi.mock('@react-native-harness/bundler-metro', () => ({
  isPortAvailable: mocks.isPortAvailable,
}));

const createConfig = (overrides: Partial<HarnessConfig> = {}): HarnessConfig =>
  ({
    appRegistryComponentName: 'App',
    bridgeTimeout: 60_000,
    bundleStartTimeout: 60_000,
    crashDetectionInterval: 500,
    defaultRunner: 'ios-device',
    detectNativeCrashes: true,
    disableViewFlattening: false,
    entryPoint: 'index.js',
    forwardClientLogs: false,
    maxAppRestarts: 2,
    metroPort: 8081,
    platformReadyTimeout: 300_000,
    resetEnvironmentBetweenTestFiles: true,
    runners: [],
    testTimeout: 5_000,
    unstable__enableMetroCache: false,
    unstable__skipAlreadyIncludedModules: false,
    ...overrides,
  } as HarnessConfig);

describe('resolveHarnessMetroPort', () => {
  it('skips fallback allocation for iOS physical device runners', async () => {
    const acquire = vi.fn();
    const config = createConfig();
    const platform: HarnessPlatform = {
      config: {},
      name: 'ios-device',
      platformId: 'ios',
      runner: 'unused',
    };

    const result = await resolveHarnessMetroPort({
      config,
      platform,
      resourceLockManager: {
        acquire,
      },
      signal: new AbortController().signal,
    });

    expect(result.config).toBe(config);
    expect(result.metroPortLease).toBeNull();
    expect(result.didFallback).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(mocks.isPortAvailable).not.toHaveBeenCalled();
  });
});
