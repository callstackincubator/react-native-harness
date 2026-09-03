import { describe, expect, it, vi } from 'vitest';
import type { CustomResolutionContext } from 'metro-resolver';
import type { MetroConfig } from 'metro-config';

const resolve = vi.hoisted(() => vi.fn<(specifier: string) => string>());

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: () => Object.assign(() => undefined, { resolve }),
  };
});

const { default: enhanceMetroConfig } = await import(
  '../metro-config-enhancer.js'
);

const context = {
  resolveRequest: vi.fn(),
} as unknown as CustomResolutionContext;

const baseConfig = (overrides?: Partial<MetroConfig>): MetroConfig =>
  ({
    resolver: { platforms: ['ios', 'android', 'native'] },
    serializer: {},
    ...overrides,
  }) as MetroConfig;

describe('windows metroConfigEnhancer', () => {
  it('adds windows and native to resolver.platforms without duplicating', () => {
    resolve.mockImplementation(() => {
      throw new Error('not resolvable');
    });

    const enhanced = enhanceMetroConfig(baseConfig(), {
      projectRoot: '/tmp/app',
      platformId: 'windows',
      platformConfig: {},
    }) as MetroConfig;

    expect(enhanced.resolver?.platforms).toEqual([
      'ios',
      'android',
      'native',
      'windows',
    ]);
  });

  it('redirects react-native imports to react-native-windows for the windows platform', () => {
    resolve.mockImplementation(() => {
      throw new Error('not resolvable');
    });
    const next = vi.fn();

    const enhanced = enhanceMetroConfig(
      baseConfig({ resolver: { resolveRequest: next } }),
      { projectRoot: '/tmp/app', platformId: 'windows', platformConfig: {} }
    ) as MetroConfig;

    const resolveRequest = enhanced.resolver?.resolveRequest;

    resolveRequest?.(context, 'react-native', 'windows');
    expect(next).toHaveBeenLastCalledWith(
      context,
      'react-native-windows',
      'windows'
    );

    resolveRequest?.(
      context,
      'react-native/Libraries/Core/InitializeCore',
      'windows'
    );
    expect(next).toHaveBeenLastCalledWith(
      context,
      'react-native-windows/Libraries/Core/InitializeCore',
      'windows'
    );
  });

  it('leaves imports untouched for other platforms and unrelated modules', () => {
    resolve.mockImplementation(() => {
      throw new Error('not resolvable');
    });
    const next = vi.fn();

    const resolveRequest = (
      enhanceMetroConfig(
        baseConfig({ resolver: { resolveRequest: next } }),
        { projectRoot: '/tmp/app', platformId: 'windows', platformConfig: {} }
      ) as MetroConfig
    ).resolver?.resolveRequest;

    resolveRequest?.(context, 'react-native', 'ios');
    expect(next).toHaveBeenLastCalledWith(context, 'react-native', 'ios');

    resolveRequest?.(context, 'react-native-svg', 'windows');
    expect(next).toHaveBeenLastCalledWith(context, 'react-native-svg', 'windows');
  });

  it('falls back to context.resolveRequest when the project sets no resolveRequest', () => {
    resolve.mockImplementation(() => {
      throw new Error('not resolvable');
    });

    const resolveRequest = (
      enhanceMetroConfig(baseConfig(), {
        projectRoot: '/tmp/app',
        platformId: 'windows',
        platformConfig: {},
      }) as MetroConfig
    ).resolver?.resolveRequest;

    resolveRequest?.(context, 'react-native', 'windows');
    expect(context.resolveRequest).toHaveBeenLastCalledWith(
      context,
      'react-native-windows',
      'windows'
    );
  });

  it('appends the react-native-windows InitializeCore to getModulesRunBeforeMainModule', () => {
    resolve.mockImplementation(
      (specifier) => `/tmp/app/node_modules/${specifier}.js`
    );

    const enhanced = enhanceMetroConfig(
      baseConfig({
        serializer: {
          getModulesRunBeforeMainModule: () => ['/rn/InitializeCore.js'],
        },
      }),
      { projectRoot: '/tmp/app', platformId: 'windows', platformConfig: {} }
    ) as MetroConfig;

    expect(
      enhanced.serializer?.getModulesRunBeforeMainModule?.('index.js')
    ).toEqual([
      '/rn/InitializeCore.js',
      '/tmp/app/node_modules/react-native-windows/Libraries/Core/InitializeCore.js',
    ]);
  });

  it('leaves getModulesRunBeforeMainModule alone when RNW InitializeCore is not resolvable', () => {
    resolve.mockImplementation(() => {
      throw new Error('not resolvable');
    });

    const runBeforeMain = () => ['/rn/InitializeCore.js'];
    const enhanced = enhanceMetroConfig(
      baseConfig({
        serializer: { getModulesRunBeforeMainModule: runBeforeMain },
      }),
      { projectRoot: '/tmp/app', platformId: 'windows', platformConfig: {} }
    ) as MetroConfig;

    expect(enhanced.serializer?.getModulesRunBeforeMainModule).toBe(
      runBeforeMain
    );
  });
});
