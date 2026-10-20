import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomResolutionContext } from 'metro-resolver';
import type { MetroConfig } from 'metro-config';
import path from 'node:path';

const resolve = vi.hoisted(() => vi.fn<(specifier: string) => string>());
const requireModule = vi.hoisted(() => vi.fn<(specifier: string) => unknown>());

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: () => Object.assign(requireModule, { resolve }),
  };
});

const { default: enhanceMetroConfig } = await import(
  '../metro-config-enhancer.js'
);

beforeEach(() => {
  resolve.mockImplementation(() => {
    throw new Error('not resolvable');
  });
  // No package.json and no Vega CLI plugin unless a test says otherwise.
  requireModule.mockImplementation(() => {
    throw new Error('not found');
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
  it('defaults resolver.platforms to kepler first, then ios, android and native', () => {
    const enhanced = enhanceMetroConfig(
      { resolver: {}, serializer: {} } as MetroConfig,
      enhancerContext
    ) as MetroConfig;

    expect(enhanced.resolver?.platforms).toEqual([
      'kepler',
      'ios',
      'android',
      'native',
    ]);
  });

  it('keeps a project-defined resolver.platforms list and only ensures native', () => {
    const enhanced = enhanceMetroConfig(
      baseConfig({ resolver: { platforms: ['kepler', 'ios'] } }),
      enhancerContext
    ) as MetroConfig;

    expect(enhanced.resolver?.platforms).toEqual(['kepler', 'ios', 'native']);
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

  describe('system bundles', () => {
    const utilsPath = '/tmp/app/node_modules/@amazon-devices/kepler-cli-platform/dist/common/systemBundleUtils.js';
    const packageJsonPath = path.join(enhancerContext.projectRoot, 'package.json');
    const applySystemBundleConfig = vi.fn();

    const withPlugin = (pkg: object) => {
      resolve.mockImplementation((specifier) => {
        if (specifier.endsWith('systemBundleUtils')) return utilsPath;
        throw new Error('not resolvable');
      });
      requireModule.mockImplementation((specifier) => {
        if (specifier === packageJsonPath) return pkg;
        if (specifier === utilsPath) return { applySystemBundleConfig };
        throw new Error('not found');
      });
    };

    it('applies the Vega CLI system bundle config for the configured build type', () => {
      withPlugin({ kepler: { projectType: 'application' } });
      const merged = { serializer: { processModuleFilter: () => true } } as MetroConfig;
      applySystemBundleConfig.mockReturnValue({ config: merged, applied: true });

      const enhanced = enhanceMetroConfig(baseConfig(), {
        ...enhancerContext,
        platformConfig: { buildType: 'Release' },
      });

      expect(applySystemBundleConfig).toHaveBeenCalledWith(
        '/tmp/app',
        'Release',
        'index.js',
        expect.objectContaining({ resolver: expect.anything() })
      );
      expect(enhanced).toBe(merged);
    });

    it('skips system bundles when the app opts out in package.json', () => {
      withPlugin({ kepler: { useSystemJsBundles: false } });
      applySystemBundleConfig.mockClear();

      const enhanced = enhanceMetroConfig(baseConfig(), enhancerContext) as MetroConfig;

      expect(applySystemBundleConfig).not.toHaveBeenCalled();
      expect(enhanced.resolver?.resolveRequest).toBeTypeOf('function');
    });

    it('falls back to a regular bundle when the Vega CLI plugin is not installed', () => {
      requireModule.mockImplementation((specifier) => {
        if (specifier === packageJsonPath) return { kepler: {} };
        throw new Error('not found');
      });

      const enhanced = enhanceMetroConfig(baseConfig(), enhancerContext) as MetroConfig;

      expect(requireModule).toHaveBeenCalledWith(packageJsonPath);
      expect(enhanced.resolver?.resolveRequest).toBeTypeOf('function');
    });
  });
});
