import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeConfig } from '../compose-config.js';
import type { CompilerConfig } from '../types.js';

const require = createRequire(import.meta.url);

// A project with a persistent cache, built twice: once plain, once the way
// Jest's --coverage builds it. The loader stands in for the real one and
// reads the same variable, so the output says which run it came from.
describe.each(['webpack', 'rspack'] as const)('the %s cache with coverage', (name) => {
  let dir: string;
  const saved = process.env.RN_HARNESS_COLLECT_COVERAGE;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `rn-harness-cache-${name}-`)));
    const write = (file: string, source: string) => fs.writeFileSync(path.join(dir, file), source);

    write('app.js', 'module.exports = require("./target.js");');
    write('target.js', 'module.exports = "target";');
    write('harness-entry.cjs', 'module.exports = require("./target.js");');
    write('test-files.cjs', 'exports.files = {};');
    write('mock.js', '');
    write(
      'instrument-loader.cjs',
      "module.exports = (source) => source + (process.env.RN_HARNESS_COLLECT_COVERAGE ? '\\n// INSTRUMENTED' : '\\n// PLAIN');"
    );
  });

  afterEach(async () => {
    // Rspack saves its cache after the build, in the background.
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (saved === undefined) {
      delete process.env.RN_HARNESS_COLLECT_COVERAGE;
    } else {
      process.env.RN_HARNESS_COLLECT_COVERAGE = saved;
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const cacheConfig = (): CompilerConfig =>
    name === 'webpack'
      ? { cache: { type: 'filesystem', cacheDirectory: path.join(dir, '.cache') } }
      : {
          experiments: {
            cache: {
              type: 'persistent',
              storage: { type: 'filesystem', directory: path.join(dir, '.cache') },
            },
          },
        };

  const build = async (coverage: boolean): Promise<string> => {
    if (coverage) {
      process.env.RN_HARNESS_COLLECT_COVERAGE = 'true';
    } else {
      delete process.env.RN_HARNESS_COLLECT_COVERAGE;
    }

    const compilerPackage = require(name === 'webpack' ? 'webpack' : '@rspack/core');
    const create = (name === 'webpack' ? compilerPackage : compilerPackage.rspack) as (
      config: CompilerConfig
    ) => {
      run: (callback: (error: Error | null, stats: { hasErrors: () => boolean; toString: (o?: object) => string }) => void) => void;
      close: (callback: () => void) => void;
    };
    const config = composeConfig(
      { context: dir, entry: './app.js', target: 'web', ...cacheConfig() },
      {
        projectRoot: dir,
        entryPoint: './app.js',
        harnessEntry: path.join(dir, 'harness-entry.cjs'),
        testFilesModule: path.join(dir, 'test-files.cjs'),
        jestGlobalsMock: path.join(dir, 'mock.js'),
        resolveWeakLoader: path.join(dir, 'instrument-loader.cjs'),
        isHarnessFile: () => false,
        watch: false,
        coverage,
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
    await new Promise<void>((resolve) => compiler.close(() => resolve()));
    // Rspack saves its cache in the background after the build.
    await new Promise((resolve) => setTimeout(resolve, 500));

    return fs.readFileSync(path.join(dir, 'dist', 'main.js'), 'utf8');
  };

  it('does not serve the plain build to a run with coverage, or the reverse', async () => {
    const first = await build(false);
    expect(first).toContain('// PLAIN');
    expect(await build(true)).toContain('// INSTRUMENTED');
    expect(await build(true)).toContain('// INSTRUMENTED');
    expect(await build(false)).toContain('// PLAIN');
  }, 60000);
});
