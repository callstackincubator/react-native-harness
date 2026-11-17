import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HarnessPlugin } from '../harness-plugin.js';
import { composeConfig } from '../compose-config.js';
import type { CompilerConfig } from '../types.js';

type Replacement = (data: Record<string, unknown>) => void;

// Records what the plugin asks of the compiler without building anything.
const createFakeCompiler = () => {
  const runtimeRequirements = new Set<string>();
  const replacement: { pattern?: RegExp; callback?: Replacement } = {};
  const errors: unknown[] = [];
  const finishModules: Array<() => void> = [];
  const compilation = {
    errors,
    hooks: {
      additionalTreeRuntimeRequirements: {
        tap: (_: string, callback: (chunk: unknown, set: Set<string>) => void) =>
          callback({}, runtimeRequirements),
      },
      finishModules: {
        tap: (_: string, callback: () => void) => finishModules.push(callback),
      },
    },
  };

  const compiler = {
    webpack: {
      RuntimeGlobals: {
        interceptModuleExecution: '__webpack_require__.i',
        moduleCache: '__webpack_require__.c',
        moduleFactories: '__webpack_require__.m',
      },
      NormalModuleReplacementPlugin: class {
        constructor(pattern: RegExp, callback: Replacement) {
          replacement.pattern = pattern;
          replacement.callback = callback;
        }
        apply() {
          return undefined;
        }
      },
    },
    hooks: {
      thisCompilation: {
        tap: (_: string, callback: (value: typeof compilation) => void) =>
          callback(compilation),
      },
    },
  };

  return {
    compiler,
    runtimeRequirements,
    replacement,
    errors,
    finishModules: () => finishModules.forEach((callback) => callback()),
  };
};

const plugin = () =>
  new HarnessPlugin({
    projectRoot: '/project',
    entryPoint: './src/index.tsx',
    harnessEntry: '/project/.harness/webpack/entry.cjs',
    entry: ['./src/polyfill.js', './src/main.js'],
  });

describe('HarnessPlugin', () => {
  it('adds the module cache, the interceptors and the factories to the runtime', () => {
    const fake = createFakeCompiler();

    plugin().apply(fake.compiler as never);

    expect([...fake.runtimeRequirements].sort()).toEqual([
      '__webpack_require__.c',
      '__webpack_require__.i',
      '__webpack_require__.m',
    ]);
  });

  describe('entry replacement with a multi-item entry', () => {
    // entry: ['./src/polyfill.js', './src/index.tsx']
    const setup = () => {
      const fake = createFakeCompiler();
      plugin().apply(fake.compiler as never);

      return fake.replacement;
    };

    it('replaces the request of the app entry before it is resolved, leaving the polyfill', () => {
      const { callback, pattern } = setup();
      const polyfill = { request: './src/polyfill.js', context: '/project' };
      const app = { request: './src/index.tsx', context: '/project' };

      expect(pattern?.test(app.request)).toBe(true);
      callback?.(polyfill);
      callback?.(app);

      expect(polyfill.request).toBe('./src/polyfill.js');
      expect(app.request).toBe('/project/.harness/webpack/entry.cjs');
    });

    it('replaces the request as webpack hands it over, with an empty createData', () => {
      const { callback } = setup();
      const app = {
        request: './src/index',
        context: '/project',
        createData: {},
      };

      callback?.(app);

      expect(app.request).toBe('/project/.harness/webpack/entry.cjs');
    });

    it('refuses an entry that is only recognized once resolved, which has the wrong loaders', () => {
      const { callback } = setup();

      expect(() =>
        callback?.({ createData: { resource: '/project/src/index.tsx' } })
      ).toThrow(/as written in the "entry"/);
      expect(() =>
        callback?.({ createData: { resource: '/project/src/polyfill.js' } })
      ).not.toThrow();
    });
  });

  it('reports a compilation error when nothing in the build is the entry point', () => {
    const fake = createFakeCompiler();
    plugin().apply(fake.compiler as never);

    fake.finishModules();

    expect(fake.errors).toHaveLength(1);
    expect(String(fake.errors[0])).toContain('./src/index.tsx');
    expect(String(fake.errors[0])).toContain('["./src/polyfill.js","./src/main.js"]');
  });

  it('reports no error when the entry was replaced', () => {
    const fake = createFakeCompiler();
    plugin().apply(fake.compiler as never);

    fake.replacement.callback?.({ request: './src/index.tsx', context: '/project' });
    fake.finishModules();

    expect(fake.errors).toEqual([]);
  });
});

// The plugin against the real compilers.
describe.each(['webpack', 'rspack'] as const)('HarnessPlugin in %s', (name) => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), `rn-harness-${name}-`))
    );
    const write = (file: string, source: string) =>
      fs.writeFileSync(path.join(dir, file), source);

    write('polyfill.js', "globalThis.order.push('polyfill');");
    write('app-entry.js', "globalThis.order.push('app');");
    write('app-entry.tsx', "globalThis.order.push('app');");
    write(
      'harness-entry.cjs',
      "globalThis.order.push('harness');" +
        'globalThis.seen = { require: typeof require, interceptors: Array.isArray(__webpack_require__.i), cache: typeof __webpack_require__.c, factories: typeof __webpack_require__.m };'
    );
    write('test-files.cjs', 'exports.files = {};');
    write('mock.js', '');
    write('passthrough-loader.cjs', 'module.exports = (source) => source;');
    // Turns a file it is given into an error unless it is TypeScript, as
    // ts-loader does for a file that is not.
    write(
      'typescript-only-loader.cjs',
      "module.exports = function (source) { if (!/\\.tsx?$/.test(this.resourcePath)) throw new Error('TypeScript emitted no output for ' + this.resourcePath); return source; };"
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const html = () => {
    const require = createRequire(import.meta.url);

    return name === 'webpack'
      ? new (require('html-webpack-plugin'))({ templateContent: '<html></html>' })
      : new (require('@rspack/core').rspack.HtmlRspackPlugin)({ templateContent: '<html></html>' });
  };

  const build = async (userConfig: CompilerConfig, entryPoint = './app-entry.js') => {
    const require = createRequire(import.meta.url);
    const compilerPackage = require(name === 'webpack' ? 'webpack' : '@rspack/core');
    const create = (name === 'webpack' ? compilerPackage : compilerPackage.rspack) as (
      config: CompilerConfig
    ) => {
      run: (callback: (error: Error | null, stats: { hasErrors: () => boolean; toString: (o?: object) => string }) => void) => void;
      close: (callback: () => void) => void;
    };
    const config = composeConfig(
      { context: dir, target: 'web', ...userConfig },
      {
        projectRoot: dir,
        entryPoint,
        harnessEntry: path.join(dir, 'harness-entry.cjs'),
        testFilesModule: path.join(dir, 'test-files.cjs'),
        jestGlobalsMock: path.join(dir, 'mock.js'),
        resolveWeakLoader: path.join(dir, 'passthrough-loader.cjs'),
        isHarnessFile: () => false,
        watch: false,
      }
    );
    config.output = { path: path.join(dir, 'dist'), filename: 'main.js' };
    const compiler = create(config);

    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) return reject(error);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolve();
      });
    });
    await new Promise<void>((resolve) => compiler.close(resolve));

    const sandbox: { order: string[]; seen?: unknown; globalThis?: unknown } = { order: [] };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'dist', 'main.js'), 'utf8'), sandbox);

    return sandbox;
  };

  it('runs the polyfill and the Harness entry instead of the app entry', async () => {
    const result = await build({ entry: ['./polyfill.js', './app-entry.js'] });

    expect(result.order).toEqual(['polyfill', 'harness']);
  });

  it('gives the build the module cache, the interceptors and the factories', async () => {
    const result = await build({ entry: ['./polyfill.js', './app-entry.js'] });

    expect(result.seen).toEqual({
      require: 'function',
      interceptors: true,
      cache: 'object',
      factories: 'object',
    });
  });

  it('replaces an entry given without its extension', async () => {
    const result = await build({ entry: ['./polyfill', './app-entry'] }, './app-entry');

    expect(result.order).toEqual(['polyfill', 'harness']);
  });

  it('gives the Harness entry the loaders of its own file, not those of the app entry', async () => {
    const result = await build(
      {
        entry: './app-entry.tsx',
        module: {
          rules: [
            { test: /\.tsx?$/, loader: path.join(dir, 'typescript-only-loader.cjs') },
          ],
        },
      },
      './app-entry.tsx'
    );

    expect(result.order).toEqual(['harness']);
  });

  it('reads the Harness entry as CommonJS in a package of "type": "module"', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');

    const result = await build({ entry: './app-entry.js' });

    expect(result.seen).toMatchObject({ require: 'function' });
  });

  it('fails the build, naming the entry, when no module is the entry point', async () => {
    await expect(
      build({ entry: ['./polyfill.js'] }, './app-entry.js')
    ).rejects.toThrow(/entryPoint "\.\/app-entry\.js"/);
  });

  it('fails the build when the entry point is only recognized through an alias', async () => {
    fs.mkdirSync(path.join(dir, 'real'));
    fs.writeFileSync(path.join(dir, 'real', 'index.js'), "globalThis.order.push('app');");

    await expect(
      build(
        { entry: 'app-alias', resolve: { alias: { 'app-alias': path.join(dir, 'real', 'index.js') } } },
        './real/index.js'
      )
    ).rejects.toThrow(/as written in the "entry"/);
  });

  describe('with an HTML plugin, which compiles a child compilation', () => {
    const errorsOf = async (entryPoint: string) => {
      const failure = await build(
        { entry: ['./polyfill.js'], plugins: [html()] },
        entryPoint
      ).then(
        () => '',
        (error: Error) => error.message
      );

      return failure.split('React Native Harness: no module').length - 1;
    };

    it('reports a missing entry point once', async () => {
      expect(await errorsOf('./nope.js')).toBe(1);
    });

    it('reports nothing for an entry point that is there', async () => {
      const result = await build(
        { entry: ['./polyfill.js', './app-entry.js'], plugins: [html()] }
      );

      expect(result.order).toEqual(['polyfill', 'harness']);
    });
  });

  it('lets another module reach the entry file once it was replaced', async () => {
    fs.writeFileSync(
      path.join(dir, 'polyfill.js'),
      "require('./app-entry-alias'); globalThis.order.push('polyfill');"
    );

    const result = await build({
      entry: ['./app-entry.js', './polyfill.js'],
      resolve: { alias: { './app-entry-alias': path.join(dir, 'app-entry.js') } },
    });

    expect(result.order).toContain('harness');
    expect(result.order).toContain('app');
  });
});
