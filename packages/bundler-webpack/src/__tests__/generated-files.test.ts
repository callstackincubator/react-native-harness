import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getGeneratedPaths,
  renderEntryModule,
  renderTestFilesModule,
  writeIfChanged,
} from '../generated-files.js';

describe('renderEntryModule', () => {
  it('sets the RN_HARNESS global with the fields Metro writes, then loads the runtime', () => {
    const source = renderEntryModule({
      appRegistryComponentName: 'MyApp',
      disableViewFlattening: true,
    });

    expect(source).toContain('globalThis.RN_HARNESS = {');
    expect(source).toContain('appRegistryComponentName: "MyApp"');
    expect(source).toContain('disableViewFlattening: true');
    expect(source).toContain(
      'require("@react-native-harness/runtime/webpack/entry-point").start(require("./test-files.cjs").files)'
    );
    expect(source.indexOf('RN_HARNESS')).toBeLessThan(source.indexOf('require('));
  });

  it('hands the files of the manifest to the runtime when it starts it', () => {
    const start = vi.fn();
    const files = {};
    const requires: Record<string, unknown> = {
      '@react-native-harness/runtime/webpack/entry-point': { start },
      './test-files.cjs': { files },
    };

    new Function('globalThis', 'require', renderEntryModule({
      appRegistryComponentName: 'App',
      disableViewFlattening: false,
    }))({}, (request: string) => requires[request]);

    expect(start).toHaveBeenCalledWith(files);
  });

  it('is valid JavaScript that sets the global', () => {
    const source = renderEntryModule({
      appRegistryComponentName: "It's \"quoted\"",
      disableViewFlattening: false,
    });
    const sandbox: { RN_HARNESS?: unknown } = {};

    new Function('globalThis', 'require', source)(sandbox, () => ({ start: () => undefined }));

    expect(sandbox.RN_HARNESS).toEqual({
      appRegistryComponentName: "It's \"quoted\"",
      disableViewFlattening: false,
    });
  });
});

describe('renderTestFilesModule', () => {
  const render = (files: string[]) =>
    renderTestFilesModule({
      files,
      projectRoot: '/project',
      fromDir: '/project/.harness/webpack',
    });

  it('maps each file, keyed as the runtime receives it, to its id and a loader', () => {
    const source = render(['src/__tests__/a.harness.tsx']);

    expect(source).toContain('"src/__tests__/a.harness.tsx": {');
    expect(source).toContain(
      'id: require.resolveWeak("../../src/__tests__/a.harness.tsx")'
    );
    expect(source).toContain(
      'require.ensure(["../../src/__tests__/a.harness.tsx"], () => resolve(), (error) => reject(error), "harness-src___tests___a.harness.tsx")'
    );
  });

  it('lists each file once, in a stable order', () => {
    const source = render(['b.ts', 'a.ts', 'b.ts']);

    expect(source.match(/^ {2}"/gm)).toHaveLength(2);
    expect(source.indexOf('"a.ts"')).toBeLessThan(source.indexOf('"b.ts"'));
    expect(render(['a.ts', 'b.ts'])).toBe(render(['b.ts', 'a.ts', 'b.ts']));
  });

  it('reaches a file outside the project root', () => {
    expect(render(['../shared/setup.ts'])).toContain(
      'require.resolveWeak("../../../shared/setup.ts")'
    );
  });

  it('is an empty manifest for no files', () => {
    const exportsOf = (source: string) => {
      const module = { exports: {} as { files?: unknown } };
      new Function('exports', source)(module.exports);

      return module.exports.files;
    };

    expect(exportsOf(render([]))).toEqual({});
  });

  it('is valid JavaScript whose loaders ask webpack for the chunk', () => {
    const calls: unknown[][] = [];
    const require = Object.assign(() => undefined, {
      resolveWeak: (request: string) => `id:${request}`,
      ensure: (...args: unknown[]) => {
        calls.push(args);
        (args[1] as () => void)();
      },
    });
    const exports: { files?: Record<string, { id: string; load: () => Promise<void> }> } = {};

    new Function('exports', 'require', render(['src/a.ts']))(exports, require);

    expect(exports.files?.['src/a.ts'].id).toBe('id:../../src/a.ts');
    return exports.files?.['src/a.ts'].load().then(() => {
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toEqual(['../../src/a.ts']);
    });
  });
});

describe('writeIfChanged', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the folder and the file, and leaves an identical file alone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-gen-'));
    dirs.push(dir);
    const file = path.join(dir, 'a', 'b', 'file.cjs');

    expect(writeIfChanged(file, 'one')).toBe(true);
    const { mtimeMs } = fs.statSync(file);
    expect(writeIfChanged(file, 'one')).toBe(false);
    expect(fs.statSync(file).mtimeMs).toBe(mtimeMs);
    expect(writeIfChanged(file, 'two')).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('two');
  });
});

describe('getGeneratedPaths', () => {
  it('keeps a directory per port, so that two runs do not share files', () => {
    const first = getGeneratedPaths('/project', 8081);
    const second = getGeneratedPaths('/project', 8082);

    expect(first.entry).toBe('/project/.harness/webpack/8081/entry.cjs');
    expect(first.testFiles).toBe('/project/.harness/webpack/8081/test-files.cjs');
    expect(second.dir).not.toBe(first.dir);
  });
});
