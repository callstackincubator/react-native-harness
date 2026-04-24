import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

import { createXCTestAgentController } from '../xctest-agent.js';
import { createDeviceXCTestAgentTransport } from '../xctest-agent-transport-device.js';
import { createSimulatorXCTestAgentTransport } from '../xctest-agent-transport-simulator.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'xctest-agent',
);
let buildRoot = '';
let tempProjectRoot = '';
const originalCwd = process.cwd();

const createLongRunningSubprocess = () => {
  let stopped = false;

  const stop = () => {
    stopped = true;
  };

  const iterable = {
    nodeChildProcess: Promise.resolve({
      kill: vi.fn(() => {
        stop();
        mocks.kill();
      }),
    }),
    async *[Symbol.asyncIterator]() {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
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
      path.join(os.tmpdir(), 'rn-harness-xctest-agent-'),
    );
    process.chdir(tempProjectRoot);
    buildRoot = path.join(tempProjectRoot, '.harness', 'xctest-agent');
    rmBuildRoot();
    mocks.activeAgentStops.length = 0;
    mocks.spawn.mockImplementation((file: string, args?: string[]) => {
      if (file === 'xcodebuild' && args?.[0] === 'test-without-building') {
        const process = createLongRunningSubprocess();
        mocks.activeAgentStops.push(process.stop);
        return process.subprocess;
      }

      return createLongRunningSubprocess().subprocess;
    });
  });

  afterEach(() => {
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
      1,
      'xcodebuild',
      expect.arrayContaining([
        'build-for-testing',
        '-destination',
        'platform=iOS Simulator,id=sim-123',
      ]),
    );
    expect(
      fs.existsSync(path.join(buildRoot, 'simulator', 'build-manifest.json')),
    ).toBe(true);
  });

  it('reuses cached build artifacts for repeated prepares on the same destination kind', async () => {
    fs.mkdirSync(path.join(buildRoot, 'device', 'Build', 'Products'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(buildRoot, 'device', 'build-manifest.json'),
      JSON.stringify({
        buildInputsHash: getCurrentInputsHash(),
        destinationKind: 'device',
      }),
    );

    const controller = createXCTestAgentController({
      target: {
        kind: 'device',
        id: 'device-123',
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

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      'xcodebuild',
      expect.arrayContaining([
        'test-without-building',
        '-destination',
        'platform=iOS Simulator,id=sim-999',
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          HARNESS_XCTEST_AGENT_MODE: 'test',
          HARNESS_XCTEST_AGENT_PORT: '49152',
        }),
      }),
    );
    expect(createSimulatorXCTestAgentTransport).toHaveBeenCalledWith({
      port: 49152,
    });
    expect(mocks.health).toHaveBeenCalledTimes(1);
    expect(mocks.configurePermissions).toHaveBeenCalledWith({
      autoAcceptPermissions: true,
    });

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
  });

  it('rebuilds when the cached build manifest no longer matches project inputs', async () => {
    fs.mkdirSync(path.join(buildRoot, 'simulator', 'Build', 'Products'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(buildRoot, 'simulator', 'build-manifest.json'),
      JSON.stringify({
        buildInputsHash: 'stale-manifest-hash',
        destinationKind: 'simulator',
      }),
    );

    const controller = createXCTestAgentController({
      target: {
        kind: 'simulator',
        id: 'sim-123',
      },
    });

    await controller.prepare();

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenNthCalledWith(
      1,
      'xcodebuild',
      expect.arrayContaining(['build-for-testing']),
    );
  });

  it('fails fast when the checked-in xcode project is missing', async () => {
    const projectPath = path.join(projectRoot, 'HarnessXCTestAgent.xcodeproj');
    const hiddenProjectPath = path.join(
      projectRoot,
      'HarnessXCTestAgent.xcodeproj.test-hidden',
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
        'Missing checked-in XCTest agent project',
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
      },
    });

    await controller.dispose();

    expect(mocks.kill).not.toHaveBeenCalled();
  });
});

const rmBuildRoot = () => {
  fs.rmSync(buildRoot, {
    force: true,
    recursive: true,
  });
};

const getCurrentInputsHash = (): string => {
  const hash = createHash('sha256');

  for (const filePath of getInputFiles(projectRoot)) {
    hash.update(path.relative(projectRoot, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  return hash.digest('hex');
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
