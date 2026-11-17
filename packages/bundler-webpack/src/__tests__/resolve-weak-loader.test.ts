import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const loaderPath = fileURLToPath(
  new URL('../../resolve-weak-loader.cjs', import.meta.url)
);

// Runs the loader in a plain Node process, as webpack does. Under Vitest,
// packages resolve to their TypeScript source, which the loader cannot load.
const runLoader = (
  resourcePath: string,
  source: string,
  env: Record<string, string> = {}
) => {
  const script = `
    const loader = require(${JSON.stringify(loaderPath)});
    const context = {
      resourcePath: ${JSON.stringify(resourcePath)},
      sourceMap: true,
      warnings: [],
      emitWarning(warning) { this.warnings.push(warning.message); },
      async() {
        return (error, code, map) => {
          console.log(JSON.stringify({ error: error && error.message, code, hasMap: !!map, warnings: this.warnings }));
        };
      },
    };
    loader.call(context, ${JSON.stringify(source)}, undefined);
  `;

  return JSON.parse(
    execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, RN_HARNESS_COLLECT_COVERAGE: '', RN_HARNESS_COVERAGE_ROOT: '', ...env },
    })
  ) as { error: string | null; code: string; hasMap: boolean; warnings: string[] };
};

describe('resolve-weak-loader', () => {
  it('gives mock, unmock and requireActual the id of the module', () => {
    const { code, hasMap } = runLoader(
      '/project/src/a.harness.tsx',
      [
        "import { mock, unmock, requireActual, render } from 'react-native-harness';",
        "import type { Foo } from './foo';",
        "mock('@app/lib/greeting', () => ({}));",
        "unmock('@app/lib/greeting');",
        "const actual = requireActual<Foo>('@app/lib/greeting');",
        'const view = <View />;',
        "render('not a module');",
      ].join('\n')
    );

    expect(code).toContain('mock(require.resolveWeak("@app/lib/greeting")');
    expect(code).toContain('unmock(require.resolveWeak("@app/lib/greeting"))');
    expect(code).toContain('requireActual<Foo>(require.resolveWeak("@app/lib/greeting"))');
    expect(code).toContain("render('not a module')");
    expect(code).toContain('<View />');
    expect(hasMap).toBe(true);
  });

  it('keeps every line where it was', () => {
    const { code } = runLoader(
      '/project/a.harness.ts',
      [
        "import { mock } from 'react-native-harness';",
        '',
        '',
        "mock('./x', () => 1);",
      ].join('\n')
    );

    expect(code.split('\n').findIndex((line) => line.includes('resolveWeak'))).toBe(3);
  });

  it('parses a TypeScript file with an angle-bracket assertion', () => {
    const { error, code } = runLoader(
      '/project/a.harness.ts',
      "import { mock } from 'react-native-harness';\nconst x = <string>y;\nmock('./x', () => 1);"
    );

    expect(error).toBeNull();
    expect(code).toMatch(/<string>\s*y/);
  });

  it('passes a file that does not use the package straight through', () => {
    const source = "const mock = (id) => id;\nmock('x');";

    expect(runLoader('/project/a.js', source).code).toBe(source);
  });

  it('does not touch mock calls that do not come from the package', () => {
    const { code } = runLoader(
      '/project/a.js',
      "import { mock } from 'other';\nimport 'react-native-harness';\nmock('x');"
    );

    expect(code).toContain("mock('x')");
  });

  it('parses decorators in TypeScript', () => {
    const { error, code, warnings } = runLoader(
      '/project/a.ts',
      "import { mock } from 'react-native-harness';\n@Component()\nclass A {}\nmock('./x', () => 1);"
    );

    expect(error).toBeNull();
    expect(warnings).toEqual([]);
    expect(code).toContain('@Component()');
    expect(code).toContain('require.resolveWeak("./x")');
  });

  it('reads .js, .jsx, .mjs and .cjs as JavaScript with JSX', () => {
    for (const file of ['a.js', 'a.jsx', 'a.mjs', 'a.cjs']) {
      const { warnings, code } = runLoader(
        `/project/${file}`,
        "import { mock } from 'react-native-harness';\nconst v = <View />;\nmock('./x', () => 1);"
      );

      expect(warnings).toEqual([]);
      expect(code).toContain('require.resolveWeak("./x")');
    }
  });

  it('does not read .js as TypeScript', () => {
    // An angle-bracket assertion is TypeScript, not JavaScript with JSX.
    const { warnings, code } = runLoader(
      '/project/a.js',
      "import 'react-native-harness';\nconst x = <string>y;"
    );

    expect(warnings).toHaveLength(1);
    expect(code).toContain('<string>y');
  });

  it('passes a file it cannot parse on unchanged, with a warning that names the file', () => {
    const source = "import 'react-native-harness';\ntype A = { a: number };";
    const { error, code, warnings } = runLoader('/project/flow.js', source);

    expect(error).toBeNull();
    expect(code).toBe(source);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('/project/flow.js');
  });

  it('leaves a syntax error in the project\'s code to the project\'s loader', () => {
    const source = "import 'react-native-harness';\nconst = ;";
    const { error, code, warnings } = runLoader('/project/a.ts', source);

    expect(error).toBeNull();
    expect(code).toBe(source);
    expect(warnings).toHaveLength(1);
  });
});

const COVERAGE = {
  RN_HARNESS_COLLECT_COVERAGE: 'true',
  RN_HARNESS_COVERAGE_ROOT: '/project',
};

describe('resolve-weak-loader with coverage', () => {
  const source = 'export const double = (n: number): number => {\n  return n * 2;\n};\n';

  it('instruments a project file that does not use the package', () => {
    const { code, hasMap, error } = runLoader('/project/src/a.ts', source, COVERAGE);

    expect(error).toBeNull();
    expect(code).toContain('__coverage__');
    expect(code).toMatch(/cov_\w+\(\)\.s\[0\]\+\+/);
    // Still TypeScript, as written: the project's transpiler comes next.
    expect(code).toContain('(n: number): number');
    expect(hasMap).toBe(true);
  });

  it('records the lines of the original source', () => {
    const { code } = runLoader('/project/src/a.ts', source, COVERAGE);
    const start = /start: \{\s*line: (\d+)/g;
    const lines = [...code.matchAll(start)].map((match) => Number(match[1]));

    expect(lines).toContain(2);
    expect(Math.max(...lines)).toBeLessThanOrEqual(3);
  });

  it('leaves out what is outside the folder coverage is collected under', () => {
    expect(runLoader('/elsewhere/a.ts', source, COVERAGE).code).not.toContain('__coverage__');
  });

  it('leaves out test files and node_modules, as Metro does', () => {
    const options = COVERAGE;

    expect(runLoader('/project/src/__tests__/a.ts', source, options).code).not.toContain('__coverage__');
    expect(runLoader('/project/node_modules/x/a.ts', source, options).code).not.toContain('__coverage__');
  });

  it('does not instrument unless Jest collects coverage', () => {
    expect(runLoader('/project/src/a.ts', source).code).toBe(source);
  });

  it('still rewrites mock calls in an instrumented file', () => {
    const { code } = runLoader(
      '/project/src/a.ts',
      "import { mock } from 'react-native-harness';\nmock('./x', () => 1);\n",
      COVERAGE
    );

    expect(code).toContain('require.resolveWeak("./x")');
    expect(code).toContain('__coverage__');
  });

  it('reads class static blocks, which the project\'s own transpiler handles', () => {
    const { error, warnings } = runLoader(
      '/project/src/a.ts',
      'export class A { static x: number; static { A.x = 1; } }\n',
      COVERAGE
    );

    expect(error).toBeNull();
    expect(warnings).toEqual([]);
  });
});
