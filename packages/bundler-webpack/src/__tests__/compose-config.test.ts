import { describe, expect, it } from 'vitest';
import { composeConfig, type ComposeOptions } from '../compose-config.js';
import { HarnessPlugin } from '../harness-plugin.js';
import type { CompilerConfig } from '../types.js';

const options: ComposeOptions = {
  projectRoot: '/project',
  entryPoint: './src/index.tsx',
  harnessEntry: '/project/.harness/webpack/entry.cjs',
  testFilesModule: '/project/.harness/webpack/test-files.cjs',
  jestGlobalsMock: '/harness/jest-globals-mock.js',
  resolveWeakLoader: '/harness/resolve-weak-loader.cjs',
};

describe('composeConfig', () => {
  it('builds in development mode', () => {
    expect(composeConfig({ mode: 'production' }, options).mode).toBe(
      'development'
    );
    expect(composeConfig({}, options).mode).toBe('development');
  });

  describe('devtool', () => {
    it.each(['source-map', 'inline-source-map', 'hidden-source-map', 'eval-source-map'])(
      'keeps %s, which maps every position',
      (devtool) => {
        expect(composeConfig({ devtool }, options).devtool).toBe(devtool);
      }
    );

    it.each([false, undefined, 'eval', 'cheap-source-map', 'eval-cheap-module-source-map', 'nosources-source-map'])(
      'replaces %s with source-map',
      (devtool) => {
        expect(composeConfig({ devtool }, options).devtool).toBe('source-map');
      }
    );
  });

  it('turns off what would merge or drop modules, and keeps the rest of optimization', () => {
    const config = composeConfig(
      {
        optimization: {
          minimize: true,
          concatenateModules: true,
          usedExports: true,
          sideEffects: true,
          splitChunks: { chunks: 'all' },
        },
      },
      options
    );

    expect(config.optimization).toMatchObject({
      minimize: false,
      concatenateModules: false,
      usedExports: false,
      sideEffects: false,
      splitChunks: { chunks: 'all' },
    });
  });

  describe('aliases', () => {
    it('adds @jest/globals next to the project aliases', () => {
      const config = composeConfig(
        { resolve: { alias: { '@app': '/project/src' }, extensions: ['.ts'] } },
        options
      );

      expect(config.resolve).toMatchObject({
        alias: {
          '@app': '/project/src',
          '@jest/globals$': '/harness/jest-globals-mock.js',
        },
        extensions: ['.ts'],
      });
    });

    it('works without any alias', () => {
      expect(composeConfig({}, options).resolve?.alias).toEqual({
        '@jest/globals$': '/harness/jest-globals-mock.js',
      });
    });

    it('adds them to the array form, before the project ones', () => {
      const config = composeConfig(
        { resolve: { alias: [{ name: '@app', alias: '/project/src' }] } },
        options
      );

      expect(config.resolve?.alias).toEqual([
        { name: '@jest/globals', alias: '/harness/jest-globals-mock.js', onlyModule: true },
        { name: '@app', alias: '/project/src' },
      ]);
    });

    it('wins over a project alias for the same module', () => {
      const config = composeConfig(
        { resolve: { alias: { '@jest/globals$': '/project/mine.js' } } },
        options
      );

      expect(config.resolve?.alias).toMatchObject({
        '@jest/globals$': '/harness/jest-globals-mock.js',
      });
    });
  });

  describe('module search path for a strict package layout', () => {
    it('adds the directory after the project ones', () => {
      const config = composeConfig(
        { resolve: { modules: ['src', 'node_modules'] } },
        { ...options, fallbackModulesDir: '/store/node_modules' }
      );

      expect(config.resolve?.modules).toEqual([
        'src',
        'node_modules',
        '/store/node_modules',
      ]);
    });

    it('keeps the default search path when the project sets none', () => {
      const config = composeConfig(
        {},
        { ...options, fallbackModulesDir: '/store/node_modules' }
      );

      expect(config.resolve?.modules).toEqual([
        'node_modules',
        '/store/node_modules',
      ]);
    });

    it('does not touch it when the project resolves the runtime itself', () => {
      expect(composeConfig({}, options).resolve?.modules).toBeUndefined();
    });
  });

  describe('rules', () => {
    const userRule = { test: /\.svg$/, type: 'asset/resource' };

    it('keeps the project rules in front of the Harness ones', () => {
      const rules = composeConfig({ module: { rules: [userRule] } }, options)
        .module?.rules;

      expect(rules?.[0]).toBe(userRule);
      expect(rules).toHaveLength(4);
    });

    it('runs the resolve-weak loader first, over the sources outside node_modules', () => {
      const rules = composeConfig({}, options).module?.rules as Array<
        Record<string, unknown>
      >;
      const loaderRule = rules.find((rule) => rule.loader) ?? {};

      expect(loaderRule).toMatchObject({
        enforce: 'pre',
        loader: '/harness/resolve-weak-loader.cjs',
      });
      expect((loaderRule.test as RegExp).test('src/a.harness.tsx')).toBe(true);
      expect((loaderRule.exclude as RegExp).test('/p/node_modules/x/a.js')).toBe(true);
    });

    it('reads the Harness packages and the generated files as javascript/auto', () => {
      const rules = composeConfig({}, options).module?.rules as Array<
        Record<string, unknown>
      >;
      const auto = rules.filter((rule) => rule.type === 'javascript/auto');
      const packages = auto.find((rule) => rule.descriptionData) ?? {};
      const name = (packages.descriptionData as { name: RegExp }).name;

      expect(name.test('@react-native-harness/runtime')).toBe(true);
      expect(name.test('@react-native-harness/ui')).toBe(true);
      expect(name.test('react-native-harness')).toBe(true);
      expect(name.test('react-native')).toBe(false);
      expect(packages.resolve).toEqual({
        extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
      });
      expect(auto.find((rule) => rule.include)).toMatchObject({
        include: [options.harnessEntry, options.testFilesModule],
      });
    });
  });

  it('adds the Harness plugin after the project plugins', () => {
    const userPlugin = { apply: () => undefined };
    const plugins = composeConfig({ plugins: [userPlugin] }, options).plugins;

    expect(plugins).toHaveLength(2);
    expect(plugins?.[0]).toBe(userPlugin);
    expect(plugins?.[1]).toBeInstanceOf(HarnessPlugin);
  });

  it('ignores every file, because the dev middleware always watches and a run builds once', () => {
    const config = composeConfig({ watchOptions: { aggregateTimeout: 50 } }, options);

    expect(config.watchOptions).toEqual({ aggregateTimeout: 50, ignored: '**/*' });
  });

  it('quiets webpack unless the project says how loud it wants it', () => {
    expect(composeConfig({}, options).infrastructureLogging).toEqual({
      level: 'warn',
    });
    expect(
      composeConfig({ infrastructureLogging: { level: 'verbose' } }, options)
        .infrastructureLogging
    ).toEqual({ level: 'verbose' });
  });

  describe('everything else', () => {
    const userConfig: CompilerConfig = {
      context: '/project',
      target: 'web',
      entry: ['./src/polyfill.js', './src/index.tsx'],
      output: { path: '/project/dist', filename: '[name].js', clean: true },
      devServer: { port: 3000 },
      cache: { type: 'filesystem' },
      externals: { jquery: 'jQuery' },
    };

    it('passes it through, including a multi-item entry', () => {
      expect(composeConfig(userConfig, options)).toMatchObject(userConfig);
    });

    it('does not change the config it is given', () => {
      const input: CompilerConfig = structuredClone({
        ...userConfig,
        resolve: { alias: { '@app': '/project/src' } },
        module: { rules: [{ test: '\\.svg$' }] },
        plugins: [],
      });
      const snapshot = structuredClone(input);

      composeConfig(input, options);

      expect(input).toEqual(snapshot);
    });
  });
});
