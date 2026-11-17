import { describe, expect, it } from 'vitest';
import { parseErrorStack } from './parse-error-stack.js';

describe('parseErrorStack', () => {
  it('parses the V8 format', () => {
    const stack = [
      'Error: boom',
      '    at fn (http://localhost:8081/tests.chunk.js:10:5)',
      '    at http://localhost:8081/main.js:20:7',
      '    at new Foo (http://localhost:8081/main.js:30:9)',
      '    at async Object.run (http://localhost:8081/main.js:40:1)',
    ].join('\n');

    expect(parseErrorStack(stack)).toEqual([
      {
        methodName: 'fn',
        file: 'http://localhost:8081/tests.chunk.js',
        lineNumber: 10,
        column: 4,
      },
      {
        methodName: '<unknown>',
        file: 'http://localhost:8081/main.js',
        lineNumber: 20,
        column: 6,
      },
      {
        methodName: 'new Foo',
        file: 'http://localhost:8081/main.js',
        lineNumber: 30,
        column: 8,
      },
      {
        methodName: 'async Object.run',
        file: 'http://localhost:8081/main.js',
        lineNumber: 40,
        column: 0,
      },
    ]);
  });

  it('parses the Firefox and Safari format', () => {
    const stack = [
      'fn@http://localhost:8081/tests.chunk.js:10:5',
      '@http://localhost:8081/main.js:20:7',
      'global code@http://localhost:8081/main.js:30:9',
    ].join('\n');

    expect(parseErrorStack(stack)).toEqual([
      {
        methodName: 'fn',
        file: 'http://localhost:8081/tests.chunk.js',
        lineNumber: 10,
        column: 4,
      },
      {
        methodName: '<unknown>',
        file: 'http://localhost:8081/main.js',
        lineNumber: 20,
        column: 6,
      },
      {
        methodName: 'global code',
        file: 'http://localhost:8081/main.js',
        lineNumber: 30,
        column: 8,
      },
    ]);
  });

  it('counts columns from 0, as the server symbolicates them', () => {
    expect(
      parseErrorStack('    at http://localhost:8081/main.js:3:1')[0]
    ).toMatchObject({ lineNumber: 3, column: 0 });
  });

  it('skips lines that are not frames', () => {
    expect(
      parseErrorStack('Error: boom\n    at Promise.all (index 0)\n[native code]')
    ).toEqual([]);
  });

  it('returns no frames for a missing stack', () => {
    expect(parseErrorStack(undefined)).toEqual([]);
    expect(parseErrorStack('')).toEqual([]);
  });
});
