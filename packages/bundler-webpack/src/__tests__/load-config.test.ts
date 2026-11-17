import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigLoadError, InvalidConfigError } from '../errors.js';
import { loadConfig } from '../load-config.js';

describe('loadConfig', () => {
  let dir: string;

  const write = (name: string, source: string) => {
    fs.writeFileSync(path.join(dir, name), source);

    return name;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-config-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads an object from a CommonJS file', async () => {
    write('a.cjs', 'module.exports = { entry: "./a.js" };');

    expect(await loadConfig(dir, './a.cjs')).toEqual({ entry: './a.js' });
  });

  it('loads an object from an ES module', async () => {
    write('a.mjs', 'export default { entry: "./a.js" };');

    expect(await loadConfig(dir, 'a.mjs')).toEqual({ entry: './a.js' });
  });

  it('calls a function the way the webpack CLI does, in development mode', async () => {
    write(
      'a.cjs',
      'module.exports = (env, argv) => ({ mode: argv.mode, hasEnv: typeof env === "object" });'
    );

    expect(await loadConfig(dir, './a.cjs')).toEqual({
      mode: 'development',
      hasEnv: true,
    });
  });

  it('awaits a function that returns a promise', async () => {
    write('a.cjs', 'module.exports = async () => ({ entry: "./b.js" });');

    expect(await loadConfig(dir, './a.cjs')).toEqual({ entry: './b.js' });
  });

  it('awaits a promise', async () => {
    write('a.cjs', 'module.exports = Promise.resolve({ entry: "./c.js" });');

    expect(await loadConfig(dir, './a.cjs')).toEqual({ entry: './c.js' });
  });

  it('unwraps a config transpiled to CommonJS', async () => {
    write(
      'a.cjs',
      'Object.defineProperty(exports, "__esModule", { value: true }); exports.default = { entry: "./t.js" };'
    );

    expect(await loadConfig(dir, './a.cjs')).toEqual({ entry: './t.js' });
  });

  it('unwraps a transpiled function', async () => {
    write(
      'a.cjs',
      'Object.defineProperty(exports, "__esModule", { value: true }); exports.default = () => ({ entry: "./f.js" });'
    );

    expect(await loadConfig(dir, './a.cjs')).toEqual({ entry: './f.js' });
  });

  it('accepts an absolute path', async () => {
    write('a.cjs', 'module.exports = { entry: "./a.js" };');

    expect(await loadConfig('/elsewhere', path.join(dir, 'a.cjs'))).toEqual({
      entry: './a.js',
    });
  });

  it('rejects an array of configurations with a clear error', async () => {
    write('a.cjs', 'module.exports = [{ entry: "./a.js" }, { entry: "./b.js" }];');

    const failure = await loadConfig(dir, './a.cjs').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(InvalidConfigError);
    expect((failure as Error).message).toMatch(/array of configurations/);
  });

  it('rejects an array returned by a function', async () => {
    write('a.cjs', 'module.exports = () => [{}];');

    await expect(loadConfig(dir, './a.cjs')).rejects.toBeInstanceOf(
      InvalidConfigError
    );
  });

  it('rejects an export that is not a configuration', async () => {
    write('a.cjs', 'module.exports = "nope";');

    await expect(loadConfig(dir, './a.cjs')).rejects.toBeInstanceOf(
      InvalidConfigError
    );
  });

  it('names the file when it cannot be loaded', async () => {
    const failure = await loadConfig(dir, './missing.cjs').catch(
      (e: unknown) => e
    );

    expect(failure).toBeInstanceOf(ConfigLoadError);
    expect((failure as Error).message).toContain('./missing.cjs');
  });
});
