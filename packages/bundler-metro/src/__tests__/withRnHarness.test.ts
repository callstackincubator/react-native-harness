import os from 'node:os';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { getConfig } from '@react-native-harness/config';

type MinimalMetroConfig = {
  projectRoot: string;
  maxWorkers?: number;
  cacheVersion?: string;
  cacheStores?: unknown;
  fileMapCacheDirectory?: string;
  hasteMapCacheDirectory?: string;
  resolver?: {
    blockList?: RegExp | RegExp[];
    useWatchman?: boolean;
  };
  serializer?: {
    isThirdPartyModule?: (module: { path: string }) => boolean;
  };
  symbolicator?: {
    customizeFrame?: (frame: { file?: string | null }) => Promise<{
      collapse: boolean;
    }>;
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
  const originalCI = process.env.CI;

  beforeEach(() => {
    delete process.env.CI;
  });

  afterEach(() => {
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
  });

  it('disables watchman when CI is set', async () => {
    process.env.CI = 'true';
    const { withRnHarness } = await import('../withRnHarness.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(config.resolver?.useWatchman).toBe(false);
  });

  it('leaves useWatchman unchanged outside CI', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    expect(config.resolver?.useWatchman).toBe(true);
  });

  it('extends an existing blockList rather than replacing it', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    const userPattern = /\/fixtures\/.*/;

    const config = (await withRnHarness(
      {
        projectRoot: '/tmp/app',
        serializer: {},
        resolver: {
          blockList: userPattern,
        },
      },
      true,
    )()) as unknown as MinimalMetroConfig;

    const blockList = config.resolver?.blockList;
    expect(Array.isArray(blockList)).toBe(true);
    expect(blockList).toContainEqual(userPattern);
    expect((blockList as RegExp[]).length).toBeGreaterThan(1);
  });

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
});
