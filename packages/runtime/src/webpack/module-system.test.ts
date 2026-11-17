import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BundlingFailedError } from '../bundler/errors.js';
import { createFakeWebpackRequire } from './__tests__/fake-webpack.js';
import { createWebpackModuleSystem, type TestFiles } from './module-system.js';
import { installWebpack } from './install.js';
import { getModuleSystem } from '../module-system.js';
import type { WebpackRequire } from './webpack-require.js';

describe('webpack module system', () => {
  let executions: string[];
  let webpackRequire: WebpackRequire;
  let files: TestFiles;
  let load: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    executions = [];
    webpackRequire = createFakeWebpackRequire({
      './a.harness.ts': (module) => {
        executions.push('a');
        module.exports = {};
      },
    });
    vi.stubGlobal('__webpack_require__', webpackRequire);
    load = vi.fn(async () => undefined);
    files = { 'src/a.harness.ts': { id: './a.harness.ts', load } };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads a file without executing it, and executes it on run', async () => {
    const moduleSystem = createWebpackModuleSystem(files);

    const loaded = await moduleSystem.loadModule('src/a.harness.ts');

    expect(load).toHaveBeenCalledTimes(1);
    expect(executions).toEqual([]);

    await loaded.run();

    expect(executions).toEqual(['a']);
  });

  it('evaluates a file again each time it runs', async () => {
    const moduleSystem = createWebpackModuleSystem(files);
    const loaded = await moduleSystem.loadModule('src/a.harness.ts');

    await loaded.run();
    await loaded.run();
    await (await moduleSystem.loadModule('src/a.harness.ts')).run();

    expect(executions).toEqual(['a', 'a', 'a']);
  });

  it('reports a file that is not in the manifest as a bundling failure', async () => {
    const moduleSystem = createWebpackModuleSystem(files);

    const failure = await moduleSystem
      .loadModule('src/missing.harness.ts')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BundlingFailedError);
    expect((failure as BundlingFailedError).reason).toMatch(/not in the list/);
  });

  it('reports a chunk that cannot be fetched as a bundling failure', async () => {
    load.mockRejectedValue(new Error('Loading chunk 7 failed'));
    const moduleSystem = createWebpackModuleSystem(files);

    const failure = await moduleSystem
      .loadModule('src/a.harness.ts')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BundlingFailedError);
    expect((failure as BundlingFailedError).reason).toBe(
      'Loading chunk 7 failed'
    );
  });

  it('rejects run when the file throws', async () => {
    webpackRequire.m['./a.harness.ts'] = () => {
      throw new Error('boom');
    };
    const moduleSystem = createWebpackModuleSystem(files);
    const loaded = await moduleSystem.loadModule('src/a.harness.ts');

    await expect(loaded.run()).rejects.toThrow('boom');
  });

  it('releases a file without side effects', async () => {
    const moduleSystem = createWebpackModuleSystem(files);

    await expect(moduleSystem.releaseModule('src/a.harness.ts')).resolves.toBe(
      undefined
    );
    expect(load).not.toHaveBeenCalled();
  });
});

describe('installWebpack', () => {
  it('installs a module system that serves the given files', async () => {
    const load = vi.fn(async () => undefined);
    installWebpack({ 'a.ts': { id: 'a', load } });

    await getModuleSystem().loadModule('a.ts');

    expect(load).toHaveBeenCalledTimes(1);
  });
});
