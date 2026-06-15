import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@react-native-harness/config';
import {
  discoverPlatformCommands,
  runPlatformCommand,
} from '../platform-commands.js';

const createCommandModuleUrl = (body: string) =>
  `data:text/javascript,${encodeURIComponent(body)}`;

const globalState = globalThis as typeof globalThis & {
  __platformCommandCall?: unknown;
};

describe('platform CLI command discovery', () => {
  afterEach(() => {
    delete globalState.__platformCommandCall;
  });

  it('runs a discovered platform command', async () => {
    const moduleUrl = createCommandModuleUrl(`
      export const commands = [{
        name: 'xctest',
        async run(args, context) {
          globalThis.__platformCommandCall = { args, context };
        }
      }];
    `);
    const loadConfig = vi.fn(async () => ({
      projectRoot: '/tmp/project',
      config: {
        entryPoint: 'index.js',
        appRegistryComponentName: 'App',
        runners: [
          {
            name: 'ios',
            config: {},
            runner: '/virtual/runner.js',
            cli: moduleUrl,
            platformId: 'ios',
          },
        ],
        plugins: [],
        metroPort: 8081,
        webSocketPort: undefined,
        bridgeTimeout: 60000,
        testTimeout: 5000,
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
      } satisfies Config,
    }));

    expect(
      await runPlatformCommand({
        argv: ['xctest', 'build', '--destination', 'simulator'],
        cwd: '/tmp/project',
        loadConfig,
      })
    ).toBe(true);
    expect(globalState.__platformCommandCall).toEqual({
      args: ['build', '--destination', 'simulator'],
      context: {
        cwd: '/tmp/project',
        projectRoot: '/tmp/project',
      },
    });
  });

  it('deduplicates platform CLI modules across runners', async () => {
    const moduleUrl = createCommandModuleUrl(`
      export const commands = [{
        name: 'xctest',
        async run() {}
      }];
    `);
    const loadConfig = vi.fn(async () => ({
      projectRoot: '/tmp/project',
      config: {
        entryPoint: 'index.js',
        appRegistryComponentName: 'App',
        runners: [
          {
            name: 'ios-sim',
            config: {},
            runner: '/virtual/ios-sim-runner.js',
            cli: moduleUrl,
            platformId: 'ios',
          },
          {
            name: 'ios-device',
            config: {},
            runner: '/virtual/ios-device-runner.js',
            cli: moduleUrl,
            platformId: 'ios',
          },
        ],
        plugins: [],
        metroPort: 8081,
        webSocketPort: undefined,
        bridgeTimeout: 60000,
        testTimeout: 5000,
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
      } satisfies Config,
    }));

    const discoveredCommands = await discoverPlatformCommands({
      cwd: '/tmp/project',
      loadConfig,
    });

    expect(discoveredCommands?.commands).toHaveLength(1);
  });

  it('returns false when no platform command matches', async () => {
    const loadConfig = vi.fn(async () => ({
      projectRoot: '/tmp/project',
      config: {
        entryPoint: 'index.js',
        appRegistryComponentName: 'App',
        runners: [
          {
            name: 'android',
            config: {},
            runner: '/virtual/android-runner.js',
            platformId: 'android',
          },
        ],
        plugins: [],
        metroPort: 8081,
        webSocketPort: undefined,
        bridgeTimeout: 60000,
        testTimeout: 5000,
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
      } satisfies Config,
    }));

    await expect(
      runPlatformCommand({
        argv: ['xctest', 'build'],
        cwd: '/tmp/project',
        loadConfig,
      })
    ).resolves.toBe(false);
  });

  it('throws when two platform modules define the same command', async () => {
    const firstModuleUrl = createCommandModuleUrl(`
      export const commands = [{
        name: 'xctest',
        async run() {}
      }];
    `);
    const secondModuleUrl = createCommandModuleUrl(`
      // second module
      export const commands = [{
        name: 'xctest',
        async run() {}
      }];
    `);
    const loadConfig = vi.fn(async () => ({
      projectRoot: '/tmp/project',
      config: {
        entryPoint: 'index.js',
        appRegistryComponentName: 'App',
        runners: [
          {
            name: 'ios',
            config: {},
            runner: '/virtual/ios-runner.js',
            cli: firstModuleUrl,
            platformId: 'ios',
          },
          {
            name: 'android',
            config: {},
            runner: '/virtual/android-runner.js',
            cli: secondModuleUrl,
            platformId: 'android',
          },
        ],
        plugins: [],
        metroPort: 8081,
        webSocketPort: undefined,
        bridgeTimeout: 60000,
        testTimeout: 5000,
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
      } satisfies Config,
    }));

    await expect(
      discoverPlatformCommands({
        cwd: '/tmp/project',
        loadConfig,
      })
    ).rejects.toThrow("Duplicate platform CLI command 'xctest'");
  });
});
