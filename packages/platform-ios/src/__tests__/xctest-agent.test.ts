import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
  spawn: vi.fn(),
}));

vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/tools')
  >('@react-native-harness/tools');

  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

vi.mock('../xctest-agent-client.js', () => ({
  createXCTestAgentClient: vi.fn(() => ({
    configurePermissions: mocks.configurePermissions,
    dispose: mocks.disposeClient,
    getPermissionsConfig: vi.fn(),
    health: mocks.health,
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

const createLongRunningSubprocess = (options?: {
  ignoreSignal?: NodeJS.Signals;
}) => {
  let stopped = false;
  const listeners = new Set<() => void>();

  const stop = () => {
    stopped = true;
    for (const listener of listeners) {
      listener();
    }
  };

  const childProcess = {
    exitCode: null,
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

describe('xctest-agent orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tempProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rn-harness-xctest-agent-')
    );
    process.chdir(tempProjectRoot);
    simulatorCacheRoot = path.join(tempProjectRoot, '.harness', 'cache');
    deviceBuildRoot = path.join(tempProjectRoot, '.harness', 'xctest-agent');
    rmBuildRoot();
    mocks.activeAgentStops.length = 0;
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
    restoreEnvVar(
      'HARNESS_IOS_XCTESTRUN_FILE',
      originalExternalXCTestRunFile
    );
    restoreEnvVar(
      'HARNESS_IOS_XCTEST_DERIVED_DATA_PATH',
      originalExternalDerivedDataPath
    );
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
      ])
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
      ])
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

    expect(mocks.kill).toHaveBeenCalledTimes(1);
    expect(mocks.disposeClient).toHaveBeenCalledTimes(1);
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
  });

  it('kills the agent process during disposal', async () => {
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
      expect.arrayContaining(['build-for-testing'])
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

const getCurrentInputsHash = (): string => {
  const hash = createHash('sha256');

  for (const filePath of getInputFiles(projectRoot)) {
    hash.update(path.relative(projectRoot, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  const sourceFilePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'xctest-agent.ts'
  );
  hash.update(path.basename(sourceFilePath));
  hash.update('\0');
  hash.update(fs.readFileSync(sourceFilePath));
  hash.update('\0');

  return hash.digest('hex');
};

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

const getInputFiles = (root: string): string[] => {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'build' || entry.name === '.gitignore') {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...getInputFiles(entryPath));
      continue;
    }

    files.push(entryPath);
  }

  return files.sort();
};
