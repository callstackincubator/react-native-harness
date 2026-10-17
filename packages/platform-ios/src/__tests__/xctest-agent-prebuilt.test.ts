import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
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

import {
  createPrebuiltXCTestAgentProvider,
  getPrebuiltIndexPath,
  packXCTestAgentArtifacts,
  readPrebuiltIndex,
  type XCTestAgentPrebuiltIndex,
} from '../xctest-agent-prebuilt.js';
import { getAgentProjectSourcesHash } from '../xctest-agent-build.js';

const xcodeVersion = '26.4.1';
const xcodeBuild = '17F103';
const simulatorSdkVersion = '26.4';
const packageVersion = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      '..',
      'package.json'
    ),
    'utf8'
  )
) as { version: string };

let tempRoot = '';
let packageRoot = '';
let projectRoot = '';

const mockXcodebuild = (options?: {
  sdkVersion?: string;
  xcodeVersion?: string;
}) => {
  mocks.spawn.mockImplementation((file: string, args?: string[]) => {
    if (file === 'xcodebuild' && args?.join(' ') === '-version') {
      return Promise.resolve({
        stdout: `Xcode ${options?.xcodeVersion ?? xcodeVersion}\nBuild version ${xcodeBuild}`,
      });
    }

    if (
      file === 'xcodebuild' &&
      args?.join(' ') === '-version -sdk iphonesimulator SDKVersion'
    ) {
      return Promise.resolve({
        stdout: options?.sdkVersion ?? simulatorSdkVersion,
      });
    }

    if (file === 'xcodebuild' && args?.[0] === 'build-for-testing') {
      const buildProductsPath = path.join(
        args[args.indexOf('-derivedDataPath') + 1],
        'Build',
        'Products'
      );
      fs.mkdirSync(path.join(buildProductsPath, 'Debug-iphonesimulator'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(
          buildProductsPath,
          'HarnessXCTestAgent_iphonesimulator26.4.xctestrun'
        ),
        'packed xctestrun'
      );
      fs.writeFileSync(
        path.join(buildProductsPath, 'Debug-iphonesimulator', 'agent'),
        'agent binary'
      );
      fs.mkdirSync(
        path.join(
          buildProductsPath,
          'Debug-iphonesimulator',
          'agent.dSYM',
          'DWARF'
        ),
        { recursive: true }
      );
      fs.writeFileSync(
        path.join(
          buildProductsPath,
          'Debug-iphonesimulator',
          'agent.dSYM',
          'DWARF',
          'agent'
        ),
        'debug symbols'
      );

      return Promise.resolve({ stdout: '' });
    }

    return Promise.resolve({ stdout: '' });
  });
};

const writeFakeArtifact = (options: {
  directoryName: string;
  xctestrunName?: string;
  withDebugSymbols?: boolean;
}) => {
  const buildProductsPath = path.join(
    packageRoot,
    'xctest-agent-prebuilds',
    options.directoryName,
    'Build',
    'Products'
  );
  const xctestrunName = options.xctestrunName ?? 'agent_iphonesimulator.xctestrun';

  fs.mkdirSync(path.join(buildProductsPath, 'Debug-iphonesimulator'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(buildProductsPath, xctestrunName),
    `xctestrun for ${options.directoryName}`
  );
  fs.writeFileSync(
    path.join(buildProductsPath, 'Debug-iphonesimulator', 'HarnessXCTestAgent.app'),
    'agent binary'
  );

  if (options.withDebugSymbols) {
    fs.mkdirSync(
      path.join(buildProductsPath, 'Debug-iphonesimulator', 'agent.dSYM'),
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(
        buildProductsPath,
        'Debug-iphonesimulator',
        'agent.dSYM',
        'DWARF'
      ),
      'symbols'
    );
    fs.mkdirSync(
      path.join(buildProductsPath, 'Debug-iphonesimulator', 'agent.swiftmodule'),
      { recursive: true }
    );
  }

  return xctestrunName;
};

const writeIndex = (index: XCTestAgentPrebuiltIndex) => {
  const indexPath = getPrebuiltIndexPath(packageRoot);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  return indexPath;
};

const makeEntry = (options: {
  agentVersion?: string;
  buildInputsHash?: string;
  directoryName: string;
  sdkVersion?: string;
  xcodeVersion?: string;
  xctestrunRelativePath: string;
}) => ({
  agentVersion: options.agentVersion ?? packageVersion.version,
  buildInputsHash: options.buildInputsHash ?? getAgentProjectSourcesHash(),
  destination: 'simulator' as const,
  directoryName: options.directoryName,
  sdkVersion: options.sdkVersion ?? simulatorSdkVersion,
  xctestrunRelativePath: options.xctestrunRelativePath,
  xcodeBuild,
  xcodeVersion: options.xcodeVersion ?? xcodeVersion,
});

const contextFor = (root = projectRoot) => ({
  destination: 'simulator' as const,
  projectRoot: root,
});

describe('prebuilt XCTest agent artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Same as in the resign suite: these tests are about the shipped artifacts,
    // so an inherited skip flag would disable the thing under test.
    delete process.env.HARNESS_SKIP_XCTEST_PREBUILDS;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-prebuilt-'));
    packageRoot = path.join(tempRoot, 'package');
    projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    mockXcodebuild();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  describe('provider', () => {
    it('declines when the package ships no artifact index', async () => {
      const provider = createPrebuiltXCTestAgentProvider({ packageRoot });

      await expect(provider.prepare(contextFor())).resolves.toBeNull();
      expect(mocks.spawn).not.toHaveBeenCalled();
    });

    it('unpacks a matching artifact into the project cache and points at its xctestrun', async () => {
      const xctestrunName = writeFakeArtifact({ directoryName: 'simulator-abc123' });
      writeIndex({
        entries: [
          makeEntry({
            directoryName: 'simulator-abc123',
            xctestrunRelativePath: xctestrunName,
          }),
        ],
        schemaVersion: 1,
      });

      const artifacts = await createPrebuiltXCTestAgentProvider({
        packageRoot,
      }).prepare(contextFor());

      expect(artifacts?.source).toBe('prebuilt');
      expect(artifacts?.launch.kind).toBe('xctestrun');
      if (artifacts?.launch.kind !== 'xctestrun') {
        throw new Error('Expected an xctestrun launch input');
      }
      expect(artifacts.launch.xctestrunPath).toBe(
        path.join(
          projectRoot,
          '.harness',
          'cache',
          'xctest-agent-prebuilt-simulator-abc123',
          'Build',
          'Products',
          xctestrunName
        )
      );
      expect(fs.readFileSync(artifacts.launch.xctestrunPath, 'utf8')).toBe(
        'xctestrun for simulator-abc123'
      );
    });

    it('leaves the packaged artifact untouched while running from the copy', async () => {
      const xctestrunName = writeFakeArtifact({ directoryName: 'simulator-abc123' });
      writeIndex({
        entries: [
          makeEntry({
            directoryName: 'simulator-abc123',
            xctestrunRelativePath: xctestrunName,
          }),
        ],
        schemaVersion: 1,
      });
      const packagedXCTestRunPath = path.join(
        packageRoot,
        'xctest-agent-prebuilds',
        'simulator-abc123',
        'Build',
        'Products',
        xctestrunName
      );

      const artifacts = await createPrebuiltXCTestAgentProvider({
        packageRoot,
      }).prepare(contextFor());
      if (artifacts?.launch.kind !== 'xctestrun') {
        throw new Error('Expected an xctestrun launch input');
      }

      fs.writeFileSync(artifacts.launch.xctestrunPath, 'written by a test session');

      expect(fs.existsSync(packagedXCTestRunPath)).toBe(true);
      expect(fs.readFileSync(packagedXCTestRunPath, 'utf8')).toBe(
        'xctestrun for simulator-abc123'
      );
    });

    it('reuses an artifact it already unpacked', async () => {
      const xctestrunName = writeFakeArtifact({ directoryName: 'simulator-abc123' });
      writeIndex({
        entries: [
          makeEntry({
            directoryName: 'simulator-abc123',
            xctestrunRelativePath: xctestrunName,
          }),
        ],
        schemaVersion: 1,
      });
      const provider = createPrebuiltXCTestAgentProvider({ packageRoot });

      const first = await provider.prepare(contextFor());
      if (first?.launch.kind !== 'xctestrun') {
        throw new Error('Expected an xctestrun launch input');
      }
      fs.writeFileSync(first.launch.xctestrunPath, 'kept from the first run');

      const second = await provider.prepare(contextFor());
      if (second?.launch.kind !== 'xctestrun') {
        throw new Error('Expected an xctestrun launch input');
      }

      expect(second.launch.xctestrunPath).toBe(first.launch.xctestrunPath);
      expect(fs.readFileSync(second.launch.xctestrunPath, 'utf8')).toBe(
        'kept from the first run'
      );
    });

    it('declines when the installed Xcode differs from the packed one', async () => {
      const xctestrunName = writeFakeArtifact({ directoryName: 'simulator-abc123' });
      writeIndex({
        entries: [
          makeEntry({
            directoryName: 'simulator-abc123',
            xcodeVersion: '16.4',
            xctestrunRelativePath: xctestrunName,
          }),
        ],
        schemaVersion: 1,
      });

      await expect(
        createPrebuiltXCTestAgentProvider({ packageRoot }).prepare(contextFor())
      ).resolves.toBeNull();
    });

    it('declines when the installed SDK differs from the packed one', async () => {
      const xctestrunName = writeFakeArtifact({ directoryName: 'simulator-abc123' });
      writeIndex({
        entries: [
          makeEntry({
            directoryName: 'simulator-abc123',
            sdkVersion: '18.5',
            xctestrunRelativePath: xctestrunName,
          }),
        ],
        schemaVersion: 1,
      });

      await expect(
        createPrebuiltXCTestAgentProvider({ packageRoot }).prepare(contextFor())
      ).resolves.toBeNull();
    });

    it('declines when the agent sources no longer match the packed ones', async () => {
      const xctestrunName = writeFakeArtifact({ directoryName: 'simulator-abc123' });
      writeIndex({
        entries: [
          makeEntry({
            buildInputsHash: 'stale-agent-hash',
            directoryName: 'simulator-abc123',
            xctestrunRelativePath: xctestrunName,
          }),
        ],
        schemaVersion: 1,
      });

      await expect(
        createPrebuiltXCTestAgentProvider({ packageRoot }).prepare(contextFor())
      ).resolves.toBeNull();
    });

    it('declines when the artifact belongs to another package version', async () => {
      const xctestrunName = writeFakeArtifact({ directoryName: 'simulator-abc123' });
      writeIndex({
        entries: [
          makeEntry({
            agentVersion: '0.0.1',
            directoryName: 'simulator-abc123',
            xctestrunRelativePath: xctestrunName,
          }),
        ],
        schemaVersion: 1,
      });

      await expect(
        createPrebuiltXCTestAgentProvider({ packageRoot }).prepare(contextFor())
      ).resolves.toBeNull();
    });

    it('declines when another destination owns the only artifact', async () => {
      const xctestrunName = writeFakeArtifact({ directoryName: 'device-abc123' });
      writeIndex({
        entries: [
          {
            ...makeEntry({
              directoryName: 'device-abc123',
              xctestrunRelativePath: xctestrunName,
            }),
            destination: 'device',
          },
        ],
        schemaVersion: 1,
      });

      await expect(
        createPrebuiltXCTestAgentProvider({ packageRoot }).prepare(contextFor())
      ).resolves.toBeNull();
    });

    it('declines when the indexed artifact is missing from the package', async () => {
      writeIndex({
        entries: [
          makeEntry({
            directoryName: 'simulator-missing',
            xctestrunRelativePath: 'agent_iphonesimulator.xctestrun',
          }),
        ],
        schemaVersion: 1,
      });

      await expect(
        createPrebuiltXCTestAgentProvider({ packageRoot }).prepare(contextFor())
      ).resolves.toBeNull();
    });

    it('ignores a malformed index', async () => {
      const indexPath = getPrebuiltIndexPath(packageRoot);
      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
      fs.writeFileSync(indexPath, 'not json');

      await expect(
        createPrebuiltXCTestAgentProvider({ packageRoot }).prepare(contextFor())
      ).resolves.toBeNull();
      expect(readPrebuiltIndex(indexPath)).toBeNull();
    });
  });

  describe('packing', () => {
    it('writes an index entry and a stripped product tree', async () => {
      const result = await packXCTestAgentArtifacts({
        agentVersion: '9.9.9',
        destination: 'simulator',
        packageRoot,
        projectRoot,
      });

      expect(result.entry).toMatchObject({
        agentVersion: '9.9.9',
        buildInputsHash: getAgentProjectSourcesHash(),
        destination: 'simulator',
        sdkVersion: simulatorSdkVersion,
        xcodeVersion,
      });
      expect(
        fs.existsSync(
          path.join(
            result.artifactDirectoryPath,
            'Build',
            'Products',
            'HarnessXCTestAgent_iphonesimulator26.4.xctestrun'
          )
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            result.artifactDirectoryPath,
            'Build',
            'Products',
            'Debug-iphonesimulator',
            'agent'
          )
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            result.artifactDirectoryPath,
            'Build',
            'Products',
            'Debug-iphonesimulator',
            'agent.dSYM'
          )
        )
      ).toBe(false);
    });

    it('replaces the artifact for a destination instead of accumulating them', async () => {
      await packXCTestAgentArtifacts({
        destination: 'simulator',
        packageRoot,
        projectRoot,
      });
      mockXcodebuild({ xcodeVersion: '26.5' });
      const second = await packXCTestAgentArtifacts({
        destination: 'simulator',
        packageRoot,
        projectRoot,
      });

      const index = readPrebuiltIndex(getPrebuiltIndexPath(packageRoot));
      expect(index?.entries).toHaveLength(1);
      expect(index?.entries[0]?.directoryName).toBe(
        second.entry.directoryName
      );
    });

    it('keeps artifacts of different destinations side by side', async () => {
      await packXCTestAgentArtifacts({
        destination: 'simulator',
        packageRoot,
        projectRoot,
      });
      writeFakeArtifact({ directoryName: 'device-abc123' });
      const indexPath = getPrebuiltIndexPath(packageRoot);
      const index = readPrebuiltIndex(indexPath);
      writeIndex({
        entries: [
          ...(index?.entries ?? []),
          {
            ...makeEntry({
              directoryName: 'device-abc123',
              xctestrunRelativePath: 'agent_iphonesimulator.xctestrun',
            }),
            destination: 'device',
          },
        ],
        schemaVersion: 1,
      });

      expect(readPrebuiltIndex(indexPath)?.entries).toHaveLength(2);
    });

    it('produces artifacts the provider accepts without rebuilding', async () => {
      const packed = await packXCTestAgentArtifacts({
        destination: 'simulator',
        packageRoot,
        projectRoot,
      });
      mocks.spawn.mockClear();

      const artifacts = await createPrebuiltXCTestAgentProvider({
        packageRoot,
      }).prepare(contextFor(path.join(tempRoot, 'consumer')));

      expect(artifacts?.source).toBe('prebuilt');
      expect(mocks.spawn.mock.calls.filter((call) => call[1]?.[0] === 'build-for-testing')).toHaveLength(0);
      expect(
        (artifacts?.launch as { xctestrunPath: string }).xctestrunPath
      ).toContain(packed.entry.directoryName);
    });
  });
});
