import { describe, expect, it } from 'vitest';
import type { Config } from '@react-native-harness/config';
import {
  addJestPlatformIgnorePatternArg,
  createPlatformTestPathIgnorePattern,
} from '../jest-platform-ignore-pattern.js';

const makeConfig = (): Config => ({
  entryPoint: 'index.js',
  appRegistryComponentName: 'App',
  defaultRunner: 'ios',
  runners: [
    {
      name: 'ios',
      platformId: 'ios',
      runner: '/virtual/ios-runner.js',
      config: {},
    },
    {
      name: 'android',
      platformId: 'android',
      runner: '/virtual/android-runner.js',
      config: {},
    },
    {
      name: 'web',
      platformId: 'web',
      runner: '/virtual/web-runner.js',
      config: {},
    },
  ],
  plugins: [],
  metroPort: 8081,
  webSocketPort: undefined,
  bridgeTimeout: 60000,
  platformReadyTimeout: 300000,
  bundleStartTimeout: 60000,
  maxAppRestarts: 2,
  resetEnvironmentBetweenTestFiles: true,
  unstable__skipAlreadyIncludedModules: false,
  unstable__enableMetroCache: false,
  permissions: false,
  detectNativeCrashes: true,
  crashDetectionInterval: 500,
  disableViewFlattening: false,
  forwardClientLogs: false,
});

describe('createPlatformTestPathIgnorePattern', () => {
  it('matches harness test files for other known platforms only', () => {
    const pattern = createPlatformTestPathIgnorePattern({
      knownPlatformIds: ['android', 'ios', 'web'],
      platformId: 'ios',
    });

    expect(pattern).toBe('\\.(android|web)\\.harness\\.(?:[mc]?[jt]sx?)$');
    if (pattern == null) {
      throw new Error('Expected platform ignore pattern to be generated');
    }

    const regex = new RegExp(pattern);
    expect(regex.test('/tests/only-android.android.harness.ts')).toBe(true);
    expect(regex.test('/tests/browser.web.harness.tsx')).toBe(true);
    expect(regex.test('/tests/only-ios.ios.harness.ts')).toBe(false);
    expect(regex.test('/tests/shared.harness.ts')).toBe(false);
    expect(regex.test('/tests/custom.foo.harness.ts')).toBe(false);
  });
});

describe('addJestPlatformIgnorePatternArg', () => {
  it('adds a Jest testPathIgnorePatterns arg for the selected runner platform', async () => {
    const argv = ['node', 'harness', '--harnessRunner', 'android'];

    await expect(
      addJestPlatformIgnorePatternArg({
        argv,
        cwd: '/tmp/project',
        loadConfig: async () => ({
          projectRoot: '/tmp/project',
          config: makeConfig(),
        }),
      }),
    ).resolves.toBe(true);

    expect(argv).toEqual([
      'node',
      'harness',
      '--harnessRunner',
      'android',
      '--testPathIgnorePatterns',
      '\\.(ios|web)\\.harness\\.(?:[mc]?[jt]sx?)$',
    ]);
  });

  it('uses the default runner when no runner CLI arg is provided', async () => {
    const argv = ['node', 'harness'];

    await expect(
      addJestPlatformIgnorePatternArg({
        argv,
        cwd: '/tmp/project',
        loadConfig: async () => ({
          projectRoot: '/tmp/project',
          config: makeConfig(),
        }),
      }),
    ).resolves.toBe(true);

    expect(argv.at(-2)).toBe('--testPathIgnorePatterns');
    expect(argv.at(-1)).toBe('\\.(android|web)\\.harness\\.(?:[mc]?[jt]sx?)$');
  });
});
