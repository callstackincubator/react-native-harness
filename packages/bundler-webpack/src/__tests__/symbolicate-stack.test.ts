import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transformSync } from '@babel/core';
import { TraceMap } from '@jridgewell/trace-mapping';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveSourcePath,
  symbolicateStack,
  type StackFrame,
} from '../symbolicate-stack.js';

let dir: string;

// eslint-disable-next-line no-control-regex
const stripColors = (text = '') => text.replace(/\u001b\[[0-9;]*m/g, '');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-symbolicate-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const URL_OF_APP = 'http://localhost:8081/app.js';

/**
 * A real source map: Babel prints the one-line `source` over several lines and
 * maps every token back to where it was. The position of `needle` in the
 * generated code is what a browser would put in a stack.
 */
const compile = (source: string, sourceName: string, needle: string) => {
  const result = transformSync(source, {
    filename: sourceName,
    sourceFileName: sourceName,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    compact: false,
    retainLines: false,
  });
  // Babel prints the source name without the `./` webpack puts in it.
  const rawMap = { ...result?.map, sources: [sourceName] };
  const lines = (result?.code ?? '').split('\n');
  const line = lines.findIndex((candidate) => candidate.includes(needle));

  return {
    map: new TraceMap(rawMap as never),
    line: line + 1,
    column: lines[line].indexOf(needle),
  };
};

const options = (
  maps: Record<string, TraceMap>,
  overrides: Partial<Parameters<typeof symbolicateStack>[1]> = {}
) => ({
  getSourceMap: async (url: string) => maps[url] ?? null,
  context: dir,
  isInternalFile: () => false,
  ...overrides,
});

const frame = (overrides: StackFrame): StackFrame => ({
  methodName: 'fn',
  file: URL_OF_APP,
  ...overrides,
});

describe('resolveSourcePath', () => {
  it.each([
    ['webpack://app/./src/a.ts', '/p/src/a.ts'],
    ['webpack://@scope/app/./src/a.ts', '/p/src/a.ts'],
    ['webpack:///./src/a.ts', '/p/src/a.ts'],
    ['webpack://app/../lib/b.ts', '/lib/b.ts'],
    // A project folder that happens to be called webpack is a project folder.
    ['webpack://app/./webpack/runtime.ts', '/p/webpack/runtime.ts'],
    ['/abs/c.ts', '/abs/c.ts'],
    // `devtoolModuleFilenameTemplate: 'webpack:///[absolute-resource-path]'`
    ['webpack:////abs/f.ts', '/abs/f.ts'],
    ['webpack:///abs/g.ts', '/abs/g.ts'],
    ['webpack://app//abs/h.ts', '/abs/h.ts'],
    ['webpack://@scope/app//abs/i.ts', '/abs/i.ts'],
    ['file:///abs/d.ts', '/abs/d.ts'],
    ['file:////abs/e.ts', '/abs/e.ts'],
  ])('resolves %s', (source, expected) => {
    expect(resolveSourcePath(source, '/p')).toBe(expected);
  });

  it.each([
    'webpack://app/webpack/runtime/global',
    'webpack-internal:///./src/a.ts',
    'external "react"',
    'webpack/runtime/global',
    'webpack://@scope/app/webpack/runtime/global',
  ])('finds no file in %s', (source) => {
    expect(resolveSourcePath(source, '/p')).toBeNull();
  });

  it('resolves a plain relative path only when the file is there', () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), '');

    expect(resolveSourcePath('./src/a.ts', dir)).toBe(path.join(dir, 'src', 'a.ts'));
    expect(resolveSourcePath('src/a.ts', dir)).toBe(path.join(dir, 'src', 'a.ts'));
    expect(resolveSourcePath('src/gone.ts', dir)).toBeNull();
  });
});

describe('symbolicateStack', () => {
  it('maps a frame to the original file, line and column, and builds the code frame', async () => {
    const original = path.join(dir, 'src', 'a.ts');
    const code = 'export const a = 1;\nexport function boom() { throw new Error("x"); }\n';
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(original, code);
    const { map, line, column } = compile(code, 'webpack://app/./src/a.ts', 'throw');

    const result = await symbolicateStack(
      [frame({ lineNumber: line, column })],
      options({ [URL_OF_APP]: map })
    );

    expect(result.stack[0]).toMatchObject({
      file: original,
      lineNumber: 2,
      column: code.split('\n')[1].indexOf('throw'),
      collapse: false,
    });
    expect(result.codeFrame).toMatchObject({
      fileName: original,
      location: { row: 2, column: code.split('\n')[1].indexOf('throw') },
    });
    expect(stripColors(result.codeFrame?.content)).toContain('throw new Error');
    // The colors Metro's code frame has.
    expect(result.codeFrame?.content).toContain('\u001b[');
  });

  it('skips collapsed frames when it picks the code frame', async () => {
    const test = path.join(dir, 'src', 'a.test.ts');
    const internal = path.join(dir, 'harness', 'expect.ts');
    fs.mkdirSync(path.dirname(test), { recursive: true });
    fs.mkdirSync(path.dirname(internal), { recursive: true });
    const testCode = 'export const t = () => expectation();\n';
    const internalCode = 'export const expectation = () => { throw new Error("no"); };\n';
    fs.writeFileSync(test, testCode);
    fs.writeFileSync(internal, internalCode);
    const a = compile(internalCode, 'webpack://app/./harness/expect.ts', 'throw');
    const b = compile(testCode, 'webpack://app/./src/a.test.ts', 'expectation()');

    const result = await symbolicateStack(
      [
        frame({ file: 'http://localhost:8081/a.js', lineNumber: a.line, column: a.column }),
        frame({ file: 'http://localhost:8081/b.js', lineNumber: b.line, column: b.column }),
      ],
      options(
        { 'http://localhost:8081/a.js': a.map, 'http://localhost:8081/b.js': b.map },
        { isInternalFile: (file) => file === internal }
      )
    );

    expect(result.stack.map(({ collapse }) => collapse)).toEqual([true, false]);
    expect(result.codeFrame?.fileName).toBe(test);
  });

  it('collapses node_modules and the bundler runtime', async () => {
    const dep = 'export const dep = () => { throw new Error("d"); };\n';
    const dependency = compile(dep, 'webpack://app/./node_modules/lib/index.js', 'throw');
    const runtime = compile(dep, 'webpack://app/webpack/runtime/global', 'throw');

    const result = await symbolicateStack(
      [
        frame({ file: 'http://localhost:8081/a.js', lineNumber: dependency.line, column: dependency.column }),
        frame({ file: 'http://localhost:8081/b.js', lineNumber: runtime.line, column: runtime.column }),
      ],
      options({ 'http://localhost:8081/a.js': dependency.map, 'http://localhost:8081/b.js': runtime.map })
    );

    expect(result.stack.map(({ collapse }) => collapse)).toEqual([true, true]);
    expect(result.stack[0].file).toBe(path.join(dir, 'node_modules', 'lib', 'index.js'));
    expect(result.stack[1].file).toBe('webpack://app/webpack/runtime/global');
  });

  it('uses a collapsed frame when every frame is collapsed', async () => {
    const file = path.join(dir, 'node_modules', 'lib', 'index.js');
    const code = 'export const dep = () => { throw new Error("d"); };\n';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, code);
    const { map, line, column } = compile(code, 'webpack://app/./node_modules/lib/index.js', 'throw');

    const result = await symbolicateStack(
      [frame({ lineNumber: line, column })],
      options({ [URL_OF_APP]: map })
    );

    expect(result.codeFrame?.fileName).toBe(file);
  });

  it('leaves a frame with no source map as it is, and makes no code frame from it', async () => {
    const unmapped = frame({ file: 'http://localhost:8081/other.js', lineNumber: 5, column: 3 });

    const result = await symbolicateStack(
      [unmapped, { methodName: 'native', file: null, lineNumber: null, column: null }],
      options({})
    );

    expect(result.stack[0]).toEqual(unmapped);
    expect(result.stack[1]).toEqual({ methodName: 'native', file: null, lineNumber: null, column: null });
    expect(result.codeFrame).toBeNull();
  });

  it('leaves a frame the map has no position for as it is', async () => {
    const { map } = compile('export const a = 1;\n', 'webpack://app/./src/a.ts', 'a');
    const unknown = frame({ lineNumber: 400, column: 0 });

    const result = await symbolicateStack([unknown], options({ [URL_OF_APP]: map }));

    expect(result.stack[0]).toEqual(unknown);
    expect(result.codeFrame).toBeNull();
  });

  it('falls back to the source in the map when the file is not on disk', async () => {
    const code = 'export function boom() { throw new Error("x"); }\n';
    const { map, line, column } = compile(code, '/virtual/boom.ts', 'throw');

    const result = await symbolicateStack(
      [frame({ lineNumber: line, column })],
      options({ [URL_OF_APP]: map })
    );

    expect(result.codeFrame?.fileName).toBe('/virtual/boom.ts');
    expect(stripColors(result.codeFrame?.content)).toContain('throw new Error');
  });
});
