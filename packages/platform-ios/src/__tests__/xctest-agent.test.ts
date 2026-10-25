import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  activeAgentStops: [] as Array<() => void>,
  configurePermissions: vi.fn(async () => ({ autoAcceptPermissions: true })),
  disposeClient: vi.fn(async () => undefined),
  disposeTransport: vi.fn(async () => undefined),
  health: vi.fn(async () => ({
    permissions: {
      autoAcceptPermissions: false,
    },
    status: 'ok',
  })),
  kill: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  spawn: vi.fn(),
  defaultTickIntervalMs: vi.fn((): number | undefined => undefined),
}));

vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/tools')
  >('@react-native-harness/tools');

  return {
    ...actual,
    spawn: mocks.spawn,
    spawnOwnedProcess: (
      file: string,
      args: string[],
      options?: Record<string, unknown>
    ) => {
      const subprocess = mocks.spawn(file, args, options);
      let disposePromise: Promise<void> | undefined;

      return {
        subprocess,
        dispose: () =>
          (disposePromise ??= actual.terminate(subprocess, {
            forceAfterMs: 1_000,
          })),
      };
    },
  };
});

vi.mock('../startup-strategy.js', () => ({
  getDefaultXCTestAgentTickIntervalMs: mocks.defaultTickIntervalMs,
}));

vi.mock('../xctest-agent-client.js', () => ({
  createXCTestAgentClient: vi.fn(() => ({
    configurePermissions: mocks.configurePermissions,
    dispose: mocks.disposeClient,
    getPermissionsConfig: vi.fn(),
    health: mocks.health,
    shutdown: mocks.shutdown,
  })),
}));

vi.mock('../xctest-agent-transport-simulator.js', () => ({
  createSimulatorXCTestAgentTransport: vi.fn(() => ({
    dispose: mocks.disposeTransport,
    request: vi.fn(),
  })),
}));

vi.mock('../xctest-agent-transport-device.js', () => ({
  createDeviceXCTestAgentTransport: vi.fn(() => ({
    dispose: mocks.disposeTransport,
    request: vi.fn(),
  })),
}));

import {
  buildXCTestAgent,
  createXCTestAgentController,
} from '../xctest-agent.js';
import { getProjectInputsHash } from '../xctest-agent-build.js';
import { createDeviceXCTestAgentTransport } from '../xctest-agent-transport-device.js';
import { createSimulatorXCTestAgentTransport } from '../xctest-agent-transport-simulator.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'xctest-agent'
);
let simulatorCacheRoot = '';
let deviceBuildRoot = '';
let tempProjectRoot = '';
const originalCwd = process.cwd();
const simulatorRuntime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-0';
const simulatorSdkVersion = '26.0';
const xcodeVersion = 'Xcode 26.0\nBuild version 17A123';
const originalExternalXCTestRunFile = process.env.HARNESS_IOS_XCTESTRUN_FILE;
const originalExternalDerivedDataPath =
  process.env.HARNESS_IOS_XCTEST_DERIVED_DATA_PATH;
const originalSkipPrebuilts = process.env.HARNESS_SKIP_XCTEST_PREBUILDS;

const createLongRunningSubprocess = (options?: {
  ignoreSignal?: NodeJS.Signals;
}) => {
  let stopped = false;
  const listeners = new Set<() => void>();

  const stop = () => {
    stopped = true;
    childProcess.exitCode = 0;
    for (const listener of listeners) {
      listener();
    }
  };

  const childProcess = {
    exitCode: null as number | null,
    kill: vi.fn((signal?: NodeJS.Signals) => {
      mocks.kill(signal);

      if (signal === options?.ignoreSignal) {
        return;
      }

      stop();
    }),
    off: vi.fn((_event: string, listener: () => void) => {
      listeners.delete(listener);
      return childProcess;
    }),
    once: vi.fn((_event: string, listener: () => void) => {
      listeners.add(listener);
      return childProcess;
    }),
    signalCode: null,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  };

  const iterable = {
    nodeChildProcess: Promise.resolve(childProcess),
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          while (!stopped) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }

          return { done: true, value: undefined };
        },
      };
    },
  };

  return {
    stop,
    subprocess: iterable,
  };
};

const createControlledSubprocess = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const childProcess = {
    exitCode: null as number | null,
    kill: vi.fn(),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
      return childProcess;
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return childProcess;
    }),
    signalCode: null as NodeJS.Signals | null,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  };

  const exit = (code: number) => {
    childProcess.exitCode = code;
    for (const listener of [...(listeners.get('close') ?? [])]) {
      listener(code, null);
    }
  };

  return {
    exit,
    subprocess: {
      nodeChildProcess: Promise.resolve(childProcess),
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: true, value: undefined }),
        };
      },
    },
  };
};

const useXcodebuildTestProcess = (subprocess: unknown) => {
  const previousImplementation = mocks.spawn.getMockImplementation();

  mocks.spawn.mockImplementation(
    (file: string, args?: string[], options?: unknown) => {
      if (file === 'xcodebuild' && args?.[0] === 'test-without-building') {
        return subprocess;
      }

      return previousImplementation?.(file, args, options);
    }
  );
};

describe('xctest-agent orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.defaultTickIntervalMs.mockReturnValue(undefined);
    delete process.env.HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS;
    // These tests cover the controller and the build provider. Shipped artifacts
    // are exercised by their own suites, and leaving them reachable here would
    // make the outcome depend on whether this checkout happens to have packed
    // any — and would decode the developer's real provisioning profiles.
    process.env.HARNESS_SKIP_XCTEST_PREBUILDS = '1';
    mocks.health.mockResolvedValue({
      permissions: {
        autoAcceptPermissions: false,
      },
      status: 'ok',
    });
    mocks.configurePermissions.mockResolvedValue({
      autoAcceptPermissions: true,
    });
    mocks.disposeClient.mockResolvedValue(undefined);
    mocks.disposeTransport.mockResolvedValue(undefined);
    tempProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rn-harness-xctest-agent-')
    );
    process.chdir(tempProjectRoot);
    simulatorCacheRoot = path.join(tempProjectRoot, '.harness', 'cache');
    deviceBuildRoot = path.join(tempProjectRoot, '.harness', 'xctest-agent');
    rmBuildRoot();
    mocks.activeAgentStops.length = 0;
    mocks.shutdown.mockImplementation(async () => {
      for (const stop of mocks.activeAgentStops) {
        stop();
      }
    });
    mocks.spawn.mockImplementation((file: string, args?: string[]) => {
      if (file === 'xcodebuild' && args?.join(' ') === '-version') {
        return Promise.resolve({ stdout: xcodeVersion });
      }

      if (
        file === 'xcodebuild' &&
        args?.join(' ') === '-version -sdk iphonesimulator SDKVersion'
      ) {
        return Promise.resolve({ stdout: simulatorSdkVersion });
      }

      if (
        file === 'xcrun' &&
        args?.join(' ') === 'simctl list devices --json'
      ) {
        return Promise.resolve({
          stdout: JSON.stringify({
            devices: {
              [simulatorRuntime]: [
                {
                  isAvailable: true,
                  name: 'iPhone 16',
                  state: 'Shutdown',
                  udid: 'sim-123',
                },
                {
                  isAvailable: true,
                  name: 'iPhone 16 Pro',
                  state: 'Shutdown',
                  udid: 'sim-999',
                },
                {
                  isAvailable: true,
                  name: 'iPhone 16 Plus',
                  state: 'Shutdown',
                  udid: 'sim-timeout',
                },
                {
                  isAvailable: true,
                  name: 'iPhone 16 Mini',
                  state: 'Shutdown',
                  udid: 'sim-404',
                },
              ],
            },
          }),
        });
      }

      if (file === 'xcodebuild' && args?.[0] === 'test-without-building') {
        const process = createLongRunningSubprocess();
        mocks.activeAgentStops.push(process.stop);
        return process.subprocess;
      }

      if (file === 'xcodebuild' && args?.[0] === 'build-for-testing') {
        const derivedDataIndex = args.indexOf('-derivedDataPath');
        const derivedDataPath =
          derivedDataIndex === -1 ? undefined : args[derivedDataIndex + 1];

        if (derivedDataPath) {
          const buildProductsPath = path.join(
            derivedDataPath,
            'Build',
            'Products'
          );
          fs.mkdirSync(path.join(buildProductsPath, 'Debug-iphonesimulator'), {
            recursive: true,
          });
          fs.writeFileSync(
            path.join(
              buildProductsPath,
              'HarnessXCTestAgent_HarnessXCTestAgent_iphonesimulator26.0-arm64.xctestrun'
            ),
            'cached xctestrun'
          );
        }
      }

      return createLongRunningSubprocess().subprocess;
    });
  });

  afterEach(() => {
    for (const stop of mocks.activeAgentStops) {
      stop();
    }
    mocks.activeAgentStops.length = 0;
    restoreEnvVar(
      'HARNESS_IOS_XCTESTRUN_FILE',
      originalExternalXCTestRunFile
    );
    restoreEnvVar(
      'HARNESS_IOS_XCTEST_DERIVED_DATA_PATH',
      originalExternalDerivedDataPath
    );
    restoreEnvVar('HARNESS_SKIP_XCTEST_PREBUILDS', originalSkipPrebuilts);
    rmBuildRoot();
    process.chdir(originalCwd);
    fs.rmSync(tempProjectRoot, { recursive: true, force: true });
    tempProjectRoot = '';
  });

  it('builds the simulator agent artifacts and writes a cache manifest', async () => {
    const controller = createXCTestAgentController({
      target: {
        kind: 'simulator',
        id: 'sim-123',
      },
    });

    await controller.prepare();

    expect(mocks.spawn).toHaveBeenNthCalledWith(
      3,
      'xcodebuild',
      expect.arrayContaining([
        'build-for-testing',
        '-destination',
        'generic/platform=iOS Simulator',
      ]),
      { cwd: projectRoot, signal: undefined }
    );
    const cacheDirectories = fs.readdirSync(simulatorCacheRoot);
    expect(cacheDirectories).toHaveLength(1);
    const cacheDirectory = cacheDirectories[0];
    expect(cacheDirectory).toBeDefined();
    if (!cacheDirectory) throw new Error('Expected cached simulator directory');
    expect(cacheDirectory).toMatch(/^xctest-agent-simulator-/);
    expect(
      fs.existsSync(
        path.join(simulatorCacheRoot, cacheDirectory, 'cache.json')
      )
    ).toBe(true);
  });

  it('builds without coverage, indexing, previews, or debug info', async () => {
    await buildXCTestAgent({ destination: 'simulator' });

    const buildArgs = mocks.spawn.mock.calls.find(
      ([file, args]) => file === 'xcodebuild' && args?.[0] === 'build-for-testing'
    )?.[1] as string[];

    expect(buildArgs).toEqual(
      expect.arrayContaining([
        'COMPILER_INDEX_STORE_ENABLE=NO',
        'ENABLE_DEBUG_DYLIB=NO',
        'ENABLE_PREVIEWS=NO',
        'GCC_GENERATE_DEBUGGING_SYMBOLS=NO',
      ])
    );
    expect(buildArgs[buildArgs.indexOf('-enableCodeCoverage') + 1]).toBe('NO');
  });

  it('builds standalone simulator agent artifacts with the generic simulator destination', async () => {
    const result = await buildXCTestAgent({
      destination: 'simulator',
    });

    expect(result.destination).toBe('simulator');
    expect(result.reused).toBe(false);
    expect(result.derivedDataPath).toContain('xctest-agent-simulator-');
    expect(result.xctestrunPath).toContain('.xctestrun');
    expect(mocks.spawn).toHaveBeenNthCalledWith(
      3,
      'xcodebuild',
      expect.arrayContaining([
        'build-for-testing',
        '-destination',
        'generic/platform=iOS Simulator',
      ]),
      { cwd: projectRoot, signal: undefined }
    );
  });

  it('reuses standalone simulator agent artifacts when cache metadata matches', async () => {
    writeSimulatorCacheDirectory({
      buildInputsHash: getCurrentInputsHash(),
      directoryName: 'xctest-agent-simulator-existing',
    });

    const result = await buildXCTestAgent({
      destination: 'simulator',
    });

    expect(result.destination).toBe('simulator');
    expect(result.reused).toBe(true);
    expect(result.derivedDataPath).toContain('xctest-agent-simulator-existing');
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it('builds standalone device agent artifacts without signing when no signing options are provided', async () => {
    await buildXCTestAgent({
      destination: 'device',
    });

    const buildCall = mocks.spawn.mock.calls[0];
    const buildArgs = buildCall?.[1] ?? [];

    expect(buildCall?.[0]).toBe('xcodebuild');
    expect(buildArgs).toEqual(
      expect.arrayContaining([
        'build-for-testing',
        '-destination',
        'generic/platform=iOS',
        'CODE_SIGNING_ALLOWED=NO',
        'CODE_SIGNING_REQUIRED=NO',
      ])
    );
    expect(buildArgs).not.toEqual(
      expect.arrayContaining([expect.stringContaining('DEVELOPMENT_TEAM=')])
    );
    expect(buildArgs).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('PROVISIONING_PROFILE_SPECIFIER='),
      ])
    );
  });

  it('builds standalone device agent artifacts with signing options when provided', async () => {
    await buildXCTestAgent({
      destination: 'device',
      signing: {
        teamId: 'TESTTEAM01',
      },
    });

    const buildCall = mocks.spawn.mock.calls[0];
    const buildArgs = buildCall?.[1] ?? [];

    expect(buildCall?.[0]).toBe('xcodebuild');
    expect(buildArgs).toEqual(
      expect.arrayContaining([
        'build-for-testing',
        '-destination',
        'generic/platform=iOS',
        '-allowProvisioningUpdates',
        'CODE_SIGN_STYLE=Automatic',
        'DEVELOPMENT_TEAM=TESTTEAM01',
        'CODE_SIGN_IDENTITY=Apple Development',
      ])
    );
    expect(buildArgs).not.toContain('CODE_SIGNING_ALLOWED=NO');
  });

  it('reuses cached build artifacts for repeated prepares on the same destination kind', async () => {
    fs.mkdirSync(path.join(deviceBuildRoot, 'device', 'Build', 'Products'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(deviceBuildRoot, 'device', 'build-manifest.json'),
      JSON.stringify({
        buildInputsHash: getCurrentInputsHash(),
        signing: {
          teamId: 'TESTTEAM01',
        },
        destinationKind: 'device',
      })
    );

    const controller = createXCTestAgentController({
      target: {
        kind: 'device',
        id: 'device-123',
        codeSign: { teamId: 'TESTTEAM01' },
      },
    });

    await controller.prepare();

    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('starts the agent lazily, waits for readiness, and configures permissions', async () => {
    const controller = createXCTestAgentController({
      port: 49152,
      target: {
        kind: 'simulator',
        id: 'sim-999',
      },
      capabilities: [
        {
          getLaunchEnvironment: () => ({
            HARNESS_XCTEST_AGENT_MODE: 'test',
          }),
          updateConfiguration: (configuration) => ({
            ...configuration,
            permissions: {
              ...configuration.permissions,
              autoAcceptPermissions: true,
            },
          }),
        },
      ],
    });

    await controller.ensureStarted();
    await controller.ensureStarted();

    expect(mocks.spawn).toHaveBeenCalledTimes(4);
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      'xcodebuild',
      expect.arrayContaining([
        'test-without-building',
        '-destination',
        'platform=iOS Simulator,id=sim-999',
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          TEST_RUNNER_HARNESS_XCTEST_AGENT_MODE: 'test',
          TEST_RUNNER_HARNESS_XCTEST_AGENT_PORT: '49152',
        }),
      })
    );
    expect(createSimulatorXCTestAgentTransport).toHaveBeenCalledWith({
      port: 49152,
    });
    expect(mocks.health).toHaveBeenCalledTimes(1);
    expect(mocks.configurePermissions).toHaveBeenCalledWith({
      autoAcceptPermissions: true,
    });
    const logDirectories = fs.readdirSync(
      path.join(tempProjectRoot, '.harness', 'logs')
    );
    expect(logDirectories).toHaveLength(1);
    const logDirectory = logDirectories[0];
    expect(logDirectory).toBeDefined();
    if (!logDirectory) throw new Error('Expected xcodebuild log directory');
    const xcodebuildLogPath = path.join(
      tempProjectRoot,
      '.harness',
      'logs',
      logDirectory,
      'xcodebuild.log'
    );
    expect(fs.existsSync(xcodebuildLogPath)).toBe(true);
    expect(fs.readFileSync(xcodebuildLogPath, 'utf8')).toContain(
      'command=xcodebuild test-without-building'
    );

    await controller.dispose();

    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
    expect(mocks.kill).not.toHaveBeenCalled();
    expect(mocks.disposeClient).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight readiness request when the session is cancelled', async () => {
    const signal = new AbortController();
    mocks.health.mockImplementation(() => new Promise(() => undefined));
    const controller = createXCTestAgentController({
      port: 49152,
      target: {
        kind: 'simulator',
        id: 'sim-999',
      },
    });

    const starting = controller.ensureStarted(signal.signal);
    await vi.waitFor(() => expect(mocks.health).toHaveBeenCalledOnce());
    signal.abort();

    await expect(starting).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.disposeClient).toHaveBeenCalledOnce();
  });

  it('fails startup with the exit status when xcodebuild exited before the agent became ready', async () => {
    const xcodebuild = createControlledSubprocess();
    xcodebuild.exit(65);
    useXcodebuildTestProcess(xcodebuild.subprocess);
    mocks.health.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:49152')
    );
    const controller = createXCTestAgentController({
      port: 49152,
      startupTimeoutMs: 1_000,
      target: {
        kind: 'simulator',
        id: 'sim-999',
      },
    });

    const startedAt = Date.now();

    await expect(controller.ensureStarted()).rejects.toThrow(
      'XCTest agent exited before becoming ready: xcodebuild exited with code 65'
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('fails startup when xcodebuild exits while the agent is still being polled', async () => {
    const xcodebuild = createControlledSubprocess();
    useXcodebuildTestProcess(xcodebuild.subprocess);
    mocks.health.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:49152')
    );
    const controller = createXCTestAgentController({
      port: 49152,
      startupTimeoutMs: 10_000,
      target: {
        kind: 'simulator',
        id: 'sim-999',
      },
    });

    const starting = controller.ensureStarted();
    await vi.waitFor(() => expect(mocks.health).toHaveBeenCalledTimes(2));
    xcodebuild.exit(65);

    await expect(starting).rejects.toThrow(
      'XCTest agent exited before becoming ready: xcodebuild exited with code 65'
    );
  });

  it('aborts the finite XCTest build when preparation is cancelled', async () => {
    const controller = new AbortController();
    let buildSignal: AbortSignal | undefined;
    mocks.spawn.mockImplementation(
      (file: string, args?: string[], options?: { signal?: AbortSignal }) => {
        if (file === 'xcodebuild' && args?.[0] === 'build-for-testing') {
          buildSignal = options?.signal;
          return new Promise<never>((_, reject) => {
            buildSignal?.addEventListener(
              'abort',
              () => reject(buildSignal?.reason),
              { once: true }
            );
          });
        }

        return createLongRunningSubprocess().subprocess;
      }
    );
    const xctest = createXCTestAgentController({
      target: {
        kind: 'device',
        id: 'device-555',
      },
    });

    const preparing = xctest.prepare(controller.signal);
    await vi.waitFor(() => expect(buildSignal).toBeDefined());
    controller.abort();

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(buildSignal?.aborted).toBe(true);
  });

  it('selects the device transport for physical devices', async () => {
    const controller = createXCTestAgentController({
      port: 49153,
      target: {
        kind: 'device',
        id: 'device-555',
        codeSign: { teamId: 'TESTTEAM01' },
      },
    });

    await controller.ensureStarted();

    expect(createDeviceXCTestAgentTransport).toHaveBeenCalledWith({
      deviceId: 'device-555',
      port: 49153,
    });
    await controller.dispose();
  });

  it('requests graceful shutdown during disposal', async () => {
    const controller = createXCTestAgentController({
      port: 49154,
      shutdownTimeoutMs: 100,
      target: {
        kind: 'simulator',
        id: 'sim-timeout',
      },
    });

    await controller.ensureStarted();
    await controller.dispose();

    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
    expect(mocks.disposeClient).toHaveBeenCalledTimes(1);
    expect(mocks.kill).not.toHaveBeenCalled();
  });

  it('clears the graceful-shutdown timers once shutdown succeeds, leaving no pending timer', async () => {
    vi.useFakeTimers();

    try {
      const controller = createXCTestAgentController({
        port: 49154,
        shutdownTimeoutMs: 30_000,
        target: {
          kind: 'simulator',
          id: 'sim-timeout',
        },
      });

      await controller.ensureStarted();
      await controller.dispose();

      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
      expect(mocks.kill).not.toHaveBeenCalled();
      // Regression coverage for the process lingering ~25s after a harness
      // run completed: waitForShutdown/waitForGracefulShutdown each raced a
      // 30s delay() against the real shutdown and never cleared it when the
      // shutdown won, leaving two ref'd Timeouts alive in the event loop.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('kills the agent process when graceful shutdown times out', async () => {
    mocks.shutdown.mockResolvedValue(undefined);

    const controller = createXCTestAgentController({
      port: 49154,
      shutdownTimeoutMs: 1,
      target: {
        kind: 'simulator',
        id: 'sim-timeout',
      },
    });

    await controller.ensureStarted();
    await controller.dispose();

    expect(mocks.kill).toHaveBeenCalledTimes(1);
    expect(mocks.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('kills the agent process when the graceful shutdown request hangs', async () => {
    mocks.shutdown.mockImplementation(
      () => new Promise<undefined>(() => undefined)
    );

    const controller = createXCTestAgentController({
      port: 49154,
      shutdownTimeoutMs: 1,
      target: {
        kind: 'simulator',
        id: 'sim-timeout',
      },
    });

    await controller.ensureStarted();
    await controller.dispose();

    expect(mocks.kill).toHaveBeenCalledTimes(1);
    expect(mocks.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('force kills the agent process when graceful shutdown times out', async () => {
    mocks.shutdown.mockResolvedValue(undefined);

    mocks.spawn.mockImplementation((file: string, args?: string[]) => {
      if (file === 'xcodebuild' && args?.join(' ') === '-version') {
        return Promise.resolve({ stdout: xcodeVersion });
      }

      if (
        file === 'xcodebuild' &&
        args?.join(' ') === '-version -sdk iphonesimulator SDKVersion'
      ) {
        return Promise.resolve({ stdout: simulatorSdkVersion });
      }

      if (
        file === 'xcrun' &&
        args?.join(' ') === 'simctl list devices --json'
      ) {
        return Promise.resolve({
          stdout: JSON.stringify({
            devices: {
              [simulatorRuntime]: [
                {
                  isAvailable: true,
                  name: 'iPhone 16 Plus',
                  state: 'Shutdown',
                  udid: 'sim-timeout',
                },
              ],
            },
          }),
        });
      }

      if (file === 'xcodebuild' && args?.[0] === 'test-without-building') {
        return createLongRunningSubprocess({ ignoreSignal: 'SIGTERM' })
          .subprocess;
      }

      if (file === 'xcodebuild' && args?.[0] === 'build-for-testing') {
        const derivedDataIndex = args.indexOf('-derivedDataPath');
        const derivedDataPath =
          derivedDataIndex === -1 ? undefined : args[derivedDataIndex + 1];

        if (derivedDataPath) {
          fs.mkdirSync(path.join(derivedDataPath, 'Build', 'Products'), {
            recursive: true,
          });
          fs.writeFileSync(
            path.join(
              derivedDataPath,
              'Build',
              'Products',
              'HarnessXCTestAgent_HarnessXCTestAgent_iphonesimulator26.0-arm64.xctestrun'
            ),
            'cached xctestrun'
          );
        }
      }

      return createLongRunningSubprocess().subprocess;
    });

    const controller = createXCTestAgentController({
      port: 49155,
      shutdownTimeoutMs: 1,
      target: {
        kind: 'simulator',
        id: 'sim-timeout',
      },
    });

    await controller.ensureStarted();
    await controller.dispose();

    expect(mocks.kill).toHaveBeenCalledTimes(2);
    expect(mocks.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(mocks.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('rebuilds when the cached build manifest no longer matches project inputs', async () => {
    writeSimulatorCacheDirectory({
      buildInputsHash: 'stale-manifest-hash',
      directoryName: 'xctest-agent-simulator-stale',
    });

    const controller = createXCTestAgentController({
      target: {
        kind: 'simulator',
        id: 'sim-123',
      },
    });

    await controller.prepare();

    expect(mocks.spawn).toHaveBeenCalledTimes(3);
    expect(mocks.spawn).toHaveBeenNthCalledWith(
      3,
      'xcodebuild',
      expect.arrayContaining(['build-for-testing']),
      { cwd: projectRoot, signal: undefined }
    );
  });

  it('reuses simulator build artifacts only when the cache metadata matches', async () => {
    writeSimulatorCacheDirectory({
      buildInputsHash: getCurrentInputsHash(),
      directoryName: 'xctest-agent-simulator-existing',
    });

    const controller = createXCTestAgentController({
      target: {
        kind: 'simulator',
        id: 'sim-123',
      },
    });

    await controller.prepare();

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it('skips building when an external xctestrun file is provided', async () => {
    const externalDerivedDataPath = path.join(tempProjectRoot, 'external-derived');
    const externalXCTestRunFilePath = path.join(
      tempProjectRoot,
      'external.xctestrun'
    );

    fs.mkdirSync(externalDerivedDataPath, { recursive: true });
    fs.writeFileSync(externalXCTestRunFilePath, 'external xctestrun');
    process.env.HARNESS_IOS_XCTESTRUN_FILE = externalXCTestRunFilePath;
    process.env.HARNESS_IOS_XCTEST_DERIVED_DATA_PATH = externalDerivedDataPath;

    const controller = createXCTestAgentController({
      port: 49152,
      target: {
        kind: 'simulator',
        id: 'sim-123',
      },
    });

    await controller.prepare();
    await controller.ensureStarted();

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenNthCalledWith(
      1,
      'xcodebuild',
      expect.arrayContaining([
        'test-without-building',
        '-xctestrun',
        externalXCTestRunFilePath,
        '-derivedDataPath',
        externalDerivedDataPath,
      ]),
      expect.any(Object)
    );
  });

  it('fails fast when the checked-in xcode project is missing', async () => {
    const projectPath = path.join(projectRoot, 'HarnessXCTestAgent.xcodeproj');
    const hiddenProjectPath = path.join(
      projectRoot,
      'HarnessXCTestAgent.xcodeproj.test-hidden'
    );

    fs.renameSync(projectPath, hiddenProjectPath);

    try {
      const controller = createXCTestAgentController({
        target: {
          kind: 'simulator',
          id: 'sim-404',
        },
      });

      await expect(controller.prepare()).rejects.toThrow(
        'Missing checked-in XCTest agent project'
      );
      expect(mocks.spawn).not.toHaveBeenCalled();
    } finally {
      fs.renameSync(hiddenProjectPath, projectPath);
    }
  });

  describe('tick interval', () => {
    const startAndGetEnv = async () => {
      const controller = createXCTestAgentController({
        port: 49152,
        target: { kind: 'simulator', id: 'sim-999' },
      });
      await controller.ensureStarted();
      const call = mocks.spawn.mock.calls.at(-1);
      return (call?.[2] as { env: Record<string, string> }).env;
    };

    afterEach(() => {
      delete process.env.HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS;
    });

    it('forwards the user-set interval unchanged over the host default', async () => {
      process.env.HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS = '500';
      mocks.defaultTickIntervalMs.mockReturnValue(2000);

      expect(
        (await startAndGetEnv()).TEST_RUNNER_HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS
      ).toBe('500');
    });

    it('forwards the constrained-host default when unset', async () => {
      mocks.defaultTickIntervalMs.mockReturnValue(2000);

      expect(
        (await startAndGetEnv()).TEST_RUNNER_HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS
      ).toBe('2000');
    });

    it('forwards nothing on unconstrained hosts when unset', async () => {
      expect(
        (await startAndGetEnv()).TEST_RUNNER_HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS
      ).toBeUndefined();
    });
  });

  it('skips killing the agent process when dispose is called before startup', async () => {
    const controller = createXCTestAgentController({
      target: {
        kind: 'device',
        id: 'device-123',
        codeSign: { teamId: 'TESTTEAM01' },
      },
    });

    await controller.dispose();

    expect(mocks.kill).not.toHaveBeenCalled();
  });
});

const rmBuildRoot = () => {
  fs.rmSync(simulatorCacheRoot, {
    force: true,
    recursive: true,
  });
  fs.rmSync(deviceBuildRoot, {
    force: true,
    recursive: true,
  });
};

const restoreEnvVar = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

const getCurrentInputsHash = (): string => getProjectInputsHash();

const writeSimulatorCacheDirectory = (options: {
  buildInputsHash: string;
  directoryName: string;
}) => {
  const derivedDataPath = path.join(simulatorCacheRoot, options.directoryName);

  fs.mkdirSync(path.join(derivedDataPath, 'Build', 'Products'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(
      derivedDataPath,
      'Build',
      'Products',
      'HarnessXCTestAgent_HarnessXCTestAgent_iphonesimulator26.0-arm64.xctestrun'
    ),
    'cached xctestrun'
  );
  fs.writeFileSync(
    path.join(derivedDataPath, 'cache.json'),
    JSON.stringify({
      artifactName: 'xctest-agent-simulator',
      buildInputsHash: options.buildInputsHash,
      destinationKind: 'simulator',
      hostArchitecture: process.arch,
      schemaVersion: 1,
      simulatorSdkVersion,
      xcodeVersion,
      xctestrunRelativePath:
        'HarnessXCTestAgent_HarnessXCTestAgent_iphonesimulator26.0-arm64.xctestrun',
    })
  );
};
