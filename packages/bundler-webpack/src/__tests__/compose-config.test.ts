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
  isHarnessFile: () => false,
  watch: false,
};

describe('composeConfig', () => {
  it('builds in development mode', () => {
    expect(composeConfig({ mode: 'production' }, options).mode).toBe(
      'development'
    );
    expect(composeConfig({}, options).mode).toBe('development');
  });

  describe('devtool', () => {
    it.each(['source-map', 'hidden-source-map', 'cheap-module-source-map'])(
      'keeps %s, which maps every position and writes a map file',
      (devtool) => {
        expect(composeConfig({ devtool }, options).devtool).toBe(devtool);
      }
    );

    it.each([false, undefined, 'eval', 'cheap-source-map', 'eval-cheap-module-source-map', 'nosources-source-map', 'inline-source-map', 'eval-source-map'])(
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
      expect((loaderRule.exclude as RegExp[])[0].test('/p/node_modules/x/a.js')).toBe(true);
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

  it('watches in watch mode, apart from dependencies unless the project says otherwise', () => {
    const watch = { ...options, watch: true };

    expect(composeConfig({}, watch).watchOptions).toEqual({
      ignored: '**/node_modules',
    });
    expect(
      composeConfig({ watchOptions: { ignored: '**/dist' } }, watch).watchOptions
    ).toEqual({ ignored: '**/dist' });
  });

  it('leaves Harness packages, dependencies and the generated files out of the loader', () => {
    const isHarnessFile = (file: string) => file.includes('/harness-pkg/');
    const config = composeConfig({}, { ...options, isHarnessFile });
    const rule = config.module?.rules?.find(
      (candidate) => (candidate as { enforce?: string }).enforce === 'pre'
    ) as { exclude: Array<RegExp | ((file: string) => boolean)> };

    expect(rule.exclude).toEqual([
      /node_modules/,
      isHarnessFile,
      options.harnessEntry,
      options.testFilesModule,
    ]);
  });

  describe('the project cache', () => {
    const loader = options.resolveWeakLoader;

    it('leaves a config without a cache, or with a memory cache, as it is', () => {
      expect(composeConfig({}, options)).not.toHaveProperty('cache');
      expect(composeConfig({}, options)).not.toHaveProperty('experiments');
      expect(composeConfig({ cache: true }, options).cache).toBe(true);
      expect(composeConfig({ cache: { type: 'memory' } }, options).cache).toEqual({ type: 'memory' });
    });

    it('watches the loader for a webpack filesystem cache, and keeps its own version', () => {
      const cache = { type: 'filesystem', version: 'v1', buildDependencies: { config: ['/p/webpack.config.js'] } };

      expect(composeConfig({ cache }, options).cache).toEqual({
        type: 'filesystem',
        version: 'v1',
        buildDependencies: { config: ['/p/webpack.config.js'], harnessLoader: [loader] },
      });
    });

    it('gives a run with coverage a cache of its own', () => {
      const cache = { type: 'filesystem', version: 'v1' };

      expect(
        (composeConfig({ cache }, { ...options, coverage: true }).cache as { version: string }).version
      ).toBe('v1+harness-coverage');
      expect((composeConfig({ cache }, options).cache as { version: string }).version).toBe('v1');
    });

    it('does the same for the persistent cache of Rspack', () => {
      const experiments = { cache: { type: 'persistent' }, other: true };
      const config = composeConfig({ experiments }, { ...options, coverage: true });

      expect(config.experiments).toEqual({
        other: true,
        cache: {
          type: 'persistent',
          version: '+harness-coverage',
          buildDependencies: [loader],
        },
      });
      expect(
        (composeConfig({ experiments: { cache: { type: 'persistent', buildDependencies: ['/x'] } } }, options)
          .experiments as { cache: { buildDependencies: string[] } }).cache.buildDependencies
      ).toEqual(['/x', loader]);
    });
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

  describe('ignoreWarnings', () => {
    const missingExport = (message: string, resource: string) => ({
      message,
      module: { resource },
    });
    const webpackMessage =
      "export 'TurboModuleRegistry' (imported as 'TurboModuleRegistry') was not found in 'react-native' (possible exports: View)";
    // Rspack prefixes the message.
    const rspackMessage = `  ⚠ ESModulesLinkingWarning: ${webpackMessage}`;
    const getIgnore = (
      config: CompilerConfig = {},
      isHarnessFile: (file: string) => boolean = () => false
    ) => {
      const list = composeConfig(config, { ...options, isHarnessFile })
        .ignoreWarnings as Array<(warning: unknown) => boolean>;

      return list[list.length - 1];
    };

    it.each([webpackMessage, rspackMessage])(
      'drops a missing react-native export from an installed Harness package (%#)',
      (message) => {
        expect(
          getIgnore()(
            missingExport(
              message,
              '/project/node_modules/@react-native-harness/ui/dist/NativeHarnessUI.js'
            )
          )
        ).toBe(true);
      }
    );

    it('drops it from a workspace Harness package', () => {
      const ignore = getIgnore({}, (file) => file.startsWith('/repo/packages/ui/'));

      expect(
        ignore(missingExport(webpackMessage, '/repo/packages/ui/dist/Native.js'))
      ).toBe(true);
    });

    it('keeps the same warning from the project and from other packages', () => {
      const ignore = getIgnore();

      expect(
        ignore(missingExport(webpackMessage, '/project/src/native.ts'))
      ).toBe(false);
      expect(
        ignore(
          missingExport(webpackMessage, '/project/node_modules/other/index.js')
        )
      ).toBe(false);
    });

    it('keeps other warnings from Harness packages', () => {
      const ignore = getIgnore();
      const file =
        '/project/node_modules/@react-native-harness/ui/dist/index.js';

      expect(
        ignore(
          missingExport(
            "export 'x' (imported as 'x') was not found in './other'",
            file
          )
        )
      ).toBe(false);
      expect(
        ignore(missingExport('Critical dependency: the request is dynamic', file))
      ).toBe(false);
      expect(ignore({ message: webpackMessage })).toBe(false);
    });

    it("keeps the project's own entries", () => {
      const own = /Module not found/;
      const list = composeConfig({ ignoreWarnings: [own] }, options)
        .ignoreWarnings as unknown[];

      expect(list[0]).toBe(own);
      expect(list).toHaveLength(2);
    });
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
