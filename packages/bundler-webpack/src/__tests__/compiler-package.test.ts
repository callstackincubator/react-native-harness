import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getCompilerFactory } from '../compiler-package.js';
import { CompilerNotFoundError } from '../errors.js';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('getCompilerFactory', () => {
  it('resolves webpack from the project', () => {
    expect(getCompilerFactory('webpack', packageRoot, path.join(packageRoot, 'webpack.config.js'))).toBeTypeOf('function');
  });

  it('resolves Rspack from the project', () => {
    expect(getCompilerFactory('rspack', packageRoot, path.join(packageRoot, 'rspack.config.js'))).toBeTypeOf('function');
  });

  it('names the package that is missing from the project', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-empty-'));

    try {
      // A folder outside any node_modules tree the compilers sit in.
      let failure: unknown;

      try {
        getCompilerFactory('rspack', empty, path.join(empty, 'rspack.config.js'));
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(CompilerNotFoundError);
      expect((failure as Error).message).toContain('@rspack/core');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('prefers the copy the config file sees over the one the project root sees', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-two-'));

    try {
      const stub = path.join(root, 'tools', 'node_modules', 'webpack');
      fs.mkdirSync(stub, { recursive: true });
      fs.writeFileSync(path.join(stub, 'package.json'), '{"name":"webpack","main":"index.js"}');
      fs.writeFileSync(path.join(stub, 'index.js'), 'module.exports = function fromConfigFolder() {};');

      const factory = getCompilerFactory(
        'webpack',
        packageRoot,
        path.join(root, 'tools', 'webpack.config.js')
      );

      expect(factory.name).toBe('fromConfigFolder');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
