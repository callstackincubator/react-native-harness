import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
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

import { createXCTestAgentController } from '../xctest-agent.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'xctest-agent',
);
const buildRoot = path.join(projectRoot, 'build');

const createLongRunningSubprocess = () => {
  let stopped = false;

  const iterable = {
    nodeChildProcess: Promise.resolve({
      kill: vi.fn(() => {
        stopped = true;
        mocks.kill();
      }),
    }),
    async *[Symbol.asyncIterator]() {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  };

  return iterable;
};

describe('xctest-agent orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rmBuildRoot();
    mocks.spawn.mockImplementation((file: string, args?: string[]) => {
      if (file === 'xcodebuild' && args?.[0] === 'test-without-building') {
        return createLongRunningSubprocess();
      }

      return createLongRunningSubprocess();
    });
  });

  afterEach(() => {
    rmBuildRoot();
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
      'xcodegen',
      expect.arrayContaining([
        'generate',
        '--spec',
        expect.stringContaining('project.yml'),
      ]),
    );
    expect(mocks.spawn).toHaveBeenNthCalledWith(
      2,
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

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith(
      'xcodegen',
      expect.arrayContaining(['generate']),
    );
  });

  it('starts the agent lazily and stops the long-lived test process on dispose', async () => {
    const controller = createXCTestAgentController({
      target: {
        kind: 'simulator',
        id: 'sim-999',
      },
      capabilities: [
        {
          getLaunchEnvironment: () => ({
            HARNESS_XCTEST_AGENT_MODE: 'test',
          }),
        },
      ],
    });

    await controller.ensureStarted();
    await controller.ensureStarted();

    expect(mocks.spawn).toHaveBeenCalledTimes(3);
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
        }),
      }),
    );

    await controller.dispose();

    expect(mocks.kill).toHaveBeenCalledTimes(1);
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
    if (
      entry.name === 'build' ||
      entry.name.endsWith('.xcodeproj') ||
      entry.name === '.gitignore'
    ) {
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
