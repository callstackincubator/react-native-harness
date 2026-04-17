import { describe, expect, it, vi } from 'vitest';

type MinimalMetroConfig = {
  projectRoot: string;
  serializer?: {
    isThirdPartyModule?: (module: { path: string }) => boolean;
  };
  symbolicator?: {
    customizeFrame?: (frame: { file?: string | null }) => Promise<{
      collapse: boolean;
    }>;
  };
};

vi.mock('@react-native-harness/config', () => ({
  getConfig: vi.fn(async () => ({
    config: {},
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
  it('treats workspace Harness packages as internal callsites', async () => {
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
        path: '/repo/packages/runtime/src/expect/errors.ts',
      }),
    ).toBe(true);

    await expect(
      config.symbolicator?.customizeFrame?.({
        file: '/repo/packages/runtime/src/expect/errors.ts',
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
        path: '/repo/apps/playground/src/__tests__/smoke.harness.ts',
      }),
    ).toBe(false);

    await expect(
      config.symbolicator?.customizeFrame?.({
        file: '/repo/apps/playground/src/__tests__/smoke.harness.ts',
      }),
    ).resolves.toEqual({
      collapse: false,
    });
  });
});
