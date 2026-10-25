import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomResolutionContext } from 'metro-resolver';
import { getConfig } from '@react-native-harness/config';
import type { MetroResolver } from '../resolvers/types.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

const createTempProject = (): string => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rn-harness-with-rn-harness-'),
  );
  tempDirs.push(projectRoot);
  return projectRoot;
};

const writeProjectFile = (
  projectRoot: string,
  relativePath: string,
  content: string,
): string => {
  const filePath = path.join(projectRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
};

// A project holding a Harness runtime module, with Harness's config and resolver
// mocked for the next withRnHarness call.
const createHarnessProject = async () => {
  const { getHarnessResolver } = await import('../resolvers/resolver.js');
  const harnessResolver = vi.fn<MetroResolver>(() => ({ type: 'empty' }));
  vi.mocked(getHarnessResolver).mockReturnValueOnce(harnessResolver);
  const projectRoot = createTempProject();
  writeProjectFile(
    projectRoot,
    'node_modules/@react-native-harness/runtime/package.json',
    JSON.stringify({ name: '@react-native-harness/runtime' }),
  );
  const harnessModule = writeProjectFile(
    projectRoot,
    'node_modules/@react-native-harness/runtime/dist/index.js',
    'export {};',
  );
  vi.mocked(getConfig).mockResolvedValueOnce({
    config: {},
    projectRoot,
  } as never);

  return { projectRoot, harnessModule, harnessResolver };
};

type MinimalMetroConfig = {
  projectRoot: string;
  maxWorkers?: number;
  cacheVersion?: string;
  cacheStores?: unknown;
  fileMapCacheDirectory?: string;
  hasteMapCacheDirectory?: string;
  serializer?: {
    isThirdPartyModule?: (module: { path: string }) => boolean;
  };
  symbolicator?: {
    customizeFrame?: (frame: { file?: string | null }) => Promise<{
      collapse: boolean;
    }>;
  };
  resolver?: {
    blockList?: RegExp;
  };
  server?: {
    useGlobalHotkey?: boolean;
  };
  transformer?: {
    unstable_workerThreads?: boolean;
  };
};

const { ensureDomainDirectories } = vi.hoisted(() => ({
  ensureDomainDirectories: vi.fn(),
}));

vi.mock('@react-native-harness/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-native-harness/config')>()),
  getConfig: vi.fn(async () => ({
    config: {},
    projectRoot: '/tmp/app',
  })),
}));

vi.mock('@react-native-harness/cache', () => ({
  createHarnessCache: vi.fn((options: { projectRoot: string }) => ({
    paths: {
      root: `${options.projectRoot}/.harness/cache`,
      metroTransform: `${options.projectRoot}/.harness/cache/metro`,
      metroFileMap: `${options.projectRoot}/.harness/cache/metro-file-map`,
    },
    isWarm: vi.fn(() => false),
    ensureDomainDirectories,
  })),
}));

vi.mock('../babel-transformer.js', () => ({
  getHarnessBabelTransformerPath: vi.fn(
    () => '/tmp/harness-babel-transformer.js',
  ),
}));

vi.mock('../manifest.js', () => ({
  getHarnessManifest: vi.fn(() => '/tmp/harness-manifest.js'),
}));

vi.mock('../metro-cache.js', () => ({
  getHarnessCacheStores: vi.fn(() => []),
}));

vi.mock('../resolvers/resolver.js', () => ({
  getHarnessResolver: vi.fn(() => vi.fn()),
}));

describe('withRnHarness', () => {
  it('treats installed Harness packages as internal callsites', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
        symbolicator: {
          async customizeFrame() {
            return {};
          },
        },
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(
      config.serializer?.isThirdPartyModule?.({
        path: '/repo/node_modules/@react-native-harness/runtime/dist/expect/errors.js',
      }),
    ).toBe(true);

    await expect(
      config.symbolicator?.customizeFrame?.({
        file: '/repo/node_modules/@react-native-harness/runtime/dist/expect/errors.js',
      }),
    ).resolves.toEqual({
      collapse: true,
    });
  });

  it('does not collapse app source files', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
        symbolicator: {
          async customizeFrame() {
            return {};
          },
        },
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(
      config.serializer?.isThirdPartyModule?.({
        path: '/repo/apps/playground/src/__tests__/normal/smoke.harness.ts',
      }),
    ).toBe(false);

    await expect(
      config.symbolicator?.customizeFrame?.({
        file: '/repo/apps/playground/src/__tests__/normal/smoke.harness.ts',
      }),
    ).resolves.toEqual({
      collapse: false,
    });
  });

  it('trims Metro functionality a harness run does not need', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
        symbolicator: {
          async customizeFrame() {
            return {};
          },
        },
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(config.server?.useGlobalHotkey).toBe(false);
    expect(config.transformer?.unstable_workerThreads).toBe(true);
  });

  it("resolves react-native from the project for Harness's modules", async () => {
    const { withRnHarness } = await import('../withRnHarness.js');
    const { projectRoot, harnessModule, harnessResolver } =
      await createHarnessProject();

    const config = (await withRnHarness(
      { projectRoot, serializer: {} },
      true,
    )()) as unknown as { resolver: { resolveRequest: MetroResolver } };

    config.resolver.resolveRequest(
      { originModulePath: harnessModule } as CustomResolutionContext,
      'react-native',
      'android',
    );

    expect(harnessResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        originModulePath: path.join(projectRoot, 'package.json'),
      }),
      'react-native',
      'android',
    );
  });

  it("runs the project's InitializeCore before the main module when Metro's config lists another copy", async () => {
    const { withRnHarness } = await import('../withRnHarness.js');
    const projectRoot = createTempProject();
    const projectInitializeCore = writeProjectFile(
      projectRoot,
      'node_modules/react-native/Libraries/Core/InitializeCore.js',
      '',
    );
    writeProjectFile(
      projectRoot,
      'node_modules/react-native/package.json',
      JSON.stringify({ name: 'react-native' }),
    );
    const workspaceInitializeCore = path.join(
      os.tmpdir(),
      'workspace',
      'node_modules',
      'react-native',
      'Libraries',
      'Core',
      'InitializeCore.js',
    );
    vi.mocked(getConfig).mockResolvedValueOnce({
      config: {},
      projectRoot,
    } as never);

    const config = (await withRnHarness(
      {
        projectRoot,
        serializer: {
          getModulesRunBeforeMainModule: () => [
            workspaceInitializeCore,
            '/tmp/other-module.js',
          ],
        },
      },
      true,
    )()) as unknown as {
      serializer: {
        getModulesRunBeforeMainModule: (entryFilePath: string) => string[];
      };
    };

    expect(
      config.serializer.getModulesRunBeforeMainModule(
        path.join(projectRoot, 'index.js'),
      ),
    ).toEqual([fs.realpathSync(projectInitializeCore), '/tmp/other-module.js']);
  });

  it('inherits the project blockList while keeping test files crawlable', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        // What `exclusionList([/ios\/build\/.*/])` produces: the project's own
        // exclusion fused with the __tests__ rule that would hide every test.
        resolver: { blockList: /(ios\/build\/.*|\/__tests__\/.*)$/ },
        serializer: {},
        symbolicator: {
          async customizeFrame() {
            return {};
          },
        },
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    const blockList = config.resolver?.blockList;

    expect(blockList).toBeInstanceOf(RegExp);
    // The project's own exclusion survives.
    expect(blockList?.test('/tmp/app/ios/build/Release/a.json')).toBe(true);
    // Harness's own cache is excluded; its manifest is not.
    expect(blockList?.test('/tmp/app/.harness/cache/metro/ab')).toBe(true);
    expect(blockList?.test('/tmp/app/.harness/manifest.js')).toBe(false);
    // Tests stay crawlable, and nothing else is excluded on harness's behalf.
    expect(blockList?.test('/tmp/app/src/__tests__/smoke.harness.ts')).toBe(
      false,
    );
    expect(blockList?.test('/tmp/app/.nx/cache/a.js')).toBe(false);
  });

  it('caps maxWorkers to leave host cores free for the device under test', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');
    const { getCappedMaxWorkers } = await import('../metro-workers.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        maxWorkers: 64,
        serializer: {},
        symbolicator: {
          async customizeFrame() {
            return {};
          },
        },
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(config.maxWorkers).toBe(
      getCappedMaxWorkers({
        configuredMaxWorkers: 64,
        hostParallelism: os.availableParallelism(),
      }),
    );
    expect(config.maxWorkers).toBeLessThan(64);
  });

  it('enables the persistent Metro cache by default', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');
    const { getHarnessCacheStores } = await import('../metro-cache.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(getHarnessCacheStores).toHaveBeenCalledWith(
      '/tmp/app/.harness/cache/metro',
    );
    expect(config.cacheStores).toBe(
      vi.mocked(getHarnessCacheStores).mock.results.at(-1)?.value,
    );
    expect(config.fileMapCacheDirectory).toBe(
      '/tmp/app/.harness/cache/metro-file-map',
    );
    expect(ensureDomainDirectories).toHaveBeenCalledWith('metro');
    expect(config.cacheVersion).toMatch(/^react-native-harness:\d+\.\d+\.\d+/);
  });

  it('respects a user-configured file map cache directory', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        fileMapCacheDirectory: '/custom/file-map',
        serializer: {},
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(config.fileMapCacheDirectory).toBe('/custom/file-map');
  });

  it('respects the legacy haste map cache directory', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        hasteMapCacheDirectory: '/custom/haste-map',
        serializer: {},
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(config.fileMapCacheDirectory).toBeUndefined();
    expect(config.hasteMapCacheDirectory).toBe('/custom/haste-map');
  });

  it('leaves Metro cache defaults untouched when caching is disabled', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    vi.mocked(getConfig).mockResolvedValueOnce({
      config: { cache: { metro: false } },
      projectRoot: '/tmp/app',
    } as Awaited<ReturnType<typeof getConfig>>);

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(config.cacheStores).toBeUndefined();
    expect(config.fileMapCacheDirectory).toBeUndefined();
  });

  it('folds the user cache version salt into the Metro cacheVersion', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    vi.mocked(getConfig).mockResolvedValueOnce({
      config: { cache: { version: 'my-salt' } },
      projectRoot: '/tmp/app',
    } as Awaited<ReturnType<typeof getConfig>>);

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(config.cacheVersion).toMatch(
      /^react-native-harness:\d+\.\d+\.\d+.*:my-salt$/,
    );
  });

  describe('metroConfigEnhancer', () => {
    // A `metroConfigEnhancer` module as a data: URL, so `withRnHarness`'s
    // `await import()` has something real to load without a fixture file.
    const enhancerRef = (body: string) => ({
      module: `data:text/javascript,${encodeURIComponent(body)}`,
      platformId: 'windows',
      platformConfig: { appName: 'Demo' },
    });

    it('runs no enhancer when none is set', async () => {
      const { withRnHarness } = await import('../withRnHarness.js');

      const config = (await withRnHarness(
        { projectRoot: '/tmp/app', serializer: {} },
        true,
      )()) as unknown as MinimalMetroConfig & { enhanced?: unknown };

      expect(config.enhanced).toBeUndefined();
      expect(config.cacheVersion).toMatch(/^react-native-harness:/);
    });

    it('runs the enhancer against the composed config, with the runner context', async () => {
      const { withRnHarness } = await import('../withRnHarness.js');

      const enhancer = enhancerRef(
        'export default (config, context) => ({ ...config, enhanced: { projectRoot: context.projectRoot, platformId: context.platformId, platformConfig: context.platformConfig, sawCacheVersion: config.cacheVersion } });',
      );

      const config = (await withRnHarness(
        { projectRoot: '/tmp/app', serializer: {} },
        true,
        enhancer,
      )()) as unknown as MinimalMetroConfig & {
        enhanced?: {
          projectRoot: string;
          platformId: string;
          platformConfig: { appName: string };
          sawCacheVersion: string;
        };
      };

      expect(config.enhanced?.projectRoot).toBe('/tmp/app');
      expect(config.enhanced?.platformId).toBe('windows');
      expect(config.enhanced?.platformConfig).toEqual({ appName: 'Demo' });
      // The enhancer saw the config the harness had already composed.
      expect(config.enhanced?.sawCacheVersion).toMatch(/^react-native-harness:/);
    });

    it('awaits an async enhancer', async () => {
      const { withRnHarness } = await import('../withRnHarness.js');

      const enhancer = enhancerRef(
        'export default async (config) => ({ ...config, enhanced: true });',
      );

      const config = (await withRnHarness(
        { projectRoot: '/tmp/app', serializer: {} },
        true,
        enhancer,
      )()) as unknown as MinimalMetroConfig & { enhanced?: boolean };

      expect(config.enhanced).toBe(true);
    });

    it("resolves react-native from the project for Harness's modules after the enhancer renames it", async () => {
      const { withRnHarness } = await import('../withRnHarness.js');
      const { projectRoot, harnessModule, harnessResolver } =
        await createHarnessProject();

      const config = (await withRnHarness(
        { projectRoot, serializer: {} },
        true,
        enhancerRef(
          "export default (config) => ({ ...config, resolver: { ...config.resolver, resolveRequest: (context, moduleName, platform) => config.resolver.resolveRequest(context, moduleName === 'react-native' ? 'react-native-windows' : moduleName, platform) } });",
        ),
      )()) as unknown as { resolver: { resolveRequest: MetroResolver } };

      config.resolver.resolveRequest(
        { originModulePath: harnessModule } as CustomResolutionContext,
        'react-native',
        'windows',
      );

      expect(harnessResolver).toHaveBeenCalledWith(
        expect.objectContaining({
          originModulePath: path.join(projectRoot, 'package.json'),
        }),
        'react-native-windows',
        'windows',
      );
    });

    it('throws when the enhancer module has no default export function', async () => {
      const { withRnHarness } = await import('../withRnHarness.js');

      await expect(
        withRnHarness(
          { projectRoot: '/tmp/app', serializer: {} },
          true,
          enhancerRef('export const notDefault = 1;'),
        )(),
      ).rejects.toThrow(/no default export function/);
    });
  });
});
