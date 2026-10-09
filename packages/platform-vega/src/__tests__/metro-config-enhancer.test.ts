import { beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  resolve.mockImplementation(() => {
    throw new Error('not resolvable');
  });
});

const context = {
  resolveRequest: vi.fn(),
} as unknown as CustomResolutionContext;

const enhancerContext = {
  projectRoot: '/tmp/app',
  platformId: 'vega',
  platformConfig: {},
};

const baseConfig = (overrides?: Partial<MetroConfig>): MetroConfig =>
  ({
    resolver: { platforms: ['ios', 'android', 'native'] },
    serializer: {},
    ...overrides,
  }) as MetroConfig;

describe('vega metroConfigEnhancer', () => {
  it('adds kepler and native to resolver.platforms without duplicating', () => {
    const enhanced = enhanceMetroConfig(
      baseConfig(),
      enhancerContext
    ) as MetroConfig;

    expect(enhanced.resolver?.platforms).toEqual([
      'ios',
      'android',
      'native',
      'kepler',
    ]);
  });

  it('redirects react-native imports to the kepler package for the kepler platform', () => {
    const next = vi.fn();

    const enhanced = enhanceMetroConfig(
      baseConfig({ resolver: { resolveRequest: next } }),
      enhancerContext
    ) as MetroConfig;
    const resolveRequest = enhanced.resolver?.resolveRequest;

    resolveRequest?.(context, 'react-native', 'kepler');
    expect(next).toHaveBeenLastCalledWith(
      context,
      '@amazon-devices/react-native-kepler',
      'kepler'
    );

    resolveRequest?.(context, 'react-native/Libraries/Core/InitializeCore', 'kepler');
    expect(next).toHaveBeenLastCalledWith(
      context,
      '@amazon-devices/react-native-kepler/Libraries/Core/InitializeCore',
      'kepler'
    );
  });

  it('leaves imports untouched for other platforms and unrelated modules', () => {
    const next = vi.fn();

    const resolveRequest = (
      enhanceMetroConfig(
        baseConfig({ resolver: { resolveRequest: next } }),
        enhancerContext
      ) as MetroConfig
    ).resolver?.resolveRequest;

    resolveRequest?.(context, 'react-native', 'ios');
    expect(next).toHaveBeenLastCalledWith(context, 'react-native', 'ios');

    resolveRequest?.(context, 'react-native-svg', 'kepler');
    expect(next).toHaveBeenLastCalledWith(context, 'react-native-svg', 'kepler');
  });

  it('falls back to context.resolveRequest when the project sets no resolveRequest', () => {
    const resolveRequest = (
      enhanceMetroConfig(baseConfig(), enhancerContext) as MetroConfig
    ).resolver?.resolveRequest;

    resolveRequest?.(context, 'react-native', 'kepler');
    expect(context.resolveRequest).toHaveBeenLastCalledWith(
      context,
      '@amazon-devices/react-native-kepler',
      'kepler'
    );
  });

  it('appends the kepler InitializeCore to getModulesRunBeforeMainModule', () => {
    resolve.mockImplementation(
      (specifier) => `/tmp/app/node_modules/${specifier}.js`
    );

    const enhanced = enhanceMetroConfig(
      baseConfig({
        serializer: {
          getModulesRunBeforeMainModule: () => ['/rn/InitializeCore.js'],
        },
      }),
      enhancerContext
    ) as MetroConfig;

    expect(
      enhanced.serializer?.getModulesRunBeforeMainModule?.('index.js')
    ).toEqual([
      '/rn/InitializeCore.js',
      '/tmp/app/node_modules/@amazon-devices/react-native-kepler/Libraries/Core/InitializeCore.js',
    ]);
  });

  it('leaves getModulesRunBeforeMainModule alone when the kepler InitializeCore is not resolvable', () => {
    const runBeforeMain = () => ['/rn/InitializeCore.js'];
    const enhanced = enhanceMetroConfig(
      baseConfig({
        serializer: { getModulesRunBeforeMainModule: runBeforeMain },
      }),
      enhancerContext
    ) as MetroConfig;

    expect(enhanced.serializer?.getModulesRunBeforeMainModule).toBe(
      runBeforeMain
    );
  });
});
