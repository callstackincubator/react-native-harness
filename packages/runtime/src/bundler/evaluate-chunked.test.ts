import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendChunkPlan,
  getChunkSource,
  readChunkPlan,
} from '../bundle-format/chunk-plan.js';
import { evaluateModule } from './evaluate.js';

const SOURCE_URL =
  'http://localhost:8081/example.harness.bundle?modulesOnly=true&platform=ios';

declare global {
  var __order: Array<{ module: number; macrotask: number }>;
  var __macrotask: number;
  var __throwers: Record<number, () => void>;
}

/**
 * Lays a bundle out the way Metro's `bundleToString` does for a
 * `modulesOnly` request: each module followed by a newline, then `post`.
 */
const buildBundle = (moduleCount: number, linesPerModule: number) => {
  const modules: Array<[number, string]> = [];

  for (let id = 0; id < moduleCount; id++) {
    const padding = `// ${'x'.repeat(60)}\n`.repeat(linesPerModule);
    modules.push([
      id,
      `globalThis.__order.push({ module: ${id}, macrotask: globalThis.__macrotask });\n` +
        `globalThis.__throwers[${id}] = function () {\n` +
        `  throw new Error('thrown by module ${id}');\n` +
        `};\n` +
        padding.trimEnd(),
    ]);
  }

  const post = `__r(${moduleCount - 1});\n//# sourceURL=${SOURCE_URL}`;
  const code =
    modules.map(([, moduleCode]) => moduleCode + '\n').join('') + post;

  return { code, modules };
};

/** The bundle line (1-based) of the `throw` inside module `id`. */
const throwLineInBundle = (code: string, id: number) =>
  code
    .split('\n')
    .findIndex((line) => line.includes(`thrown by module ${id}`)) + 1;

const stackLineFor = (error: unknown): number | null => {
  const stack = (error as Error).stack ?? '';
  const escaped = SOURCE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stack.match(new RegExp(`${escaped}:(\\d+):\\d+`));

  return match ? Number(match[1]) : null;
};

describe('chunk plan', () => {
  it('round-trips a bundle into chunks that cover it exactly', () => {
    const { code, modules } = buildBundle(40, 200);
    const plan = readChunkPlan(
      appendChunkPlan(code, { pre: '', modules }, { sourceUrl: SOURCE_URL, targetBytes: 64 * 1024 }),
    );

    expect(plan).not.toBeNull();
    if (!plan) return;

    expect(plan.bundle.slice(0, plan.codeLength)).toBe(code);
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.map((chunk) => code.slice(chunk.start, chunk.end)).join('')).toBe(code);

    for (const chunk of plan.chunks) {
      const source = getChunkSource(plan, chunk);
      const padding = source.length - source.trimStart().length;
      // Leading newlines put the chunk back on its original line.
      expect(padding).toBe(chunk.startLine);
      expect(code.slice(0, chunk.start).split('\n').length - 1).toBe(chunk.startLine);
      // Every chunk names the bundle, so its frames can be symbolicated.
      expect(source).toContain(`//# sourceURL=${SOURCE_URL}`);
    }
  });

  it('adds no plan when the bundle fits in one chunk', () => {
    const { code, modules } = buildBundle(2, 1);

    expect(appendChunkPlan(code, { pre: '', modules })).toBe(code);
  });

  it('adds no plan when the code does not match the module layout', () => {
    const { code, modules } = buildBundle(40, 200);

    expect(
      appendChunkPlan('// unexpected\n' + code, { pre: '', modules }, { targetBytes: 64 * 1024 }),
    ).toBe('// unexpected\n' + code);
  });

  it('treats a malformed plan as no plan', () => {
    expect(readChunkPlan('__r(1);\n//# harnessChunks={"chunks":"nope"}')).toBeNull();
    expect(readChunkPlan('__r(1);\n//# harnessChunks={not json')).toBeNull();
    expect(readChunkPlan('__r(1);\n//# harnessChunks={"chunks":[[3,0]]}')).toBeNull();
  });

  it.each([
    ['a negative line', [[0, 0], [5, -1]]],
    ['a fractional line', [[0, 0], [5, 1.5]]],
    ['a non-finite line', [[0, 0], [5, Infinity]]],
    ['lines going backwards', [[0, 0], [5, 3], [8, 2]]],
    ['more lines than characters', [[0, 0], [5, 6]]],
    ['a first chunk not on line 0', [[0, 1], [5, 2]]],
  ])('treats a plan with %s as no plan', (_name, chunks) => {
    const code = '__d(1);\n__d(2);\n__r(2);\n';
    // JSON has no Infinity: stringify writes it as null, and the plan
    // reader would parse 1e400 back as Infinity.
    const bundle = `${code}\n//# harnessChunks=${JSON.stringify({ chunks }).replace('null', '1e400')}`;

    expect(readChunkPlan(bundle)).toBeNull();
  });
});

describe('evaluateModule with a chunk plan', () => {
  const resetModule = vi.fn();
  let ticking = true;

  beforeEach(() => {
    vi.stubGlobal('__resetModule', resetModule);
    vi.stubGlobal('__r', vi.fn());
    globalThis.__order = [];
    globalThis.__throwers = {};
    globalThis.__macrotask = 0;
    ticking = true;
    const tick = () => {
      if (!ticking) return;
      globalThis.__macrotask++;
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  });

  afterEach(() => {
    ticking = false;
    vi.unstubAllGlobals();
    resetModule.mockReset();
  });

  const evaluateChunked = async () => {
    const { code, modules } = buildBundle(40, 200);
    const bundle = appendChunkPlan(
      code,
      { pre: '', modules },
      { sourceUrl: SOURCE_URL, targetBytes: 64 * 1024 },
    );
    const plan = readChunkPlan(bundle);

    await evaluateModule(bundle, 'example.harness.tsx');

    if (!plan) {
      throw new Error('expected a chunk plan');
    }

    return { code, plan };
  };

  it('evaluates every module once, in order, and resets the entry module', async () => {
    await evaluateChunked();

    expect(globalThis.__order.map((entry) => entry.module)).toEqual(
      Array.from({ length: 40 }, (_, i) => i),
    );
    expect(resetModule).toHaveBeenCalledWith(39);
  });

  it('sends events emitted before it ahead of evaluation', async () => {
    // Models the bridge sending an event one microtask after it is emitted,
    // here the setup-file-bundling-finished that precedes evaluation.
    vi.stubGlobal('__sent', []);
    vi.stubGlobal('__sentAtEvaluation', null);
    queueMicrotask(() => {
      (globalThis as unknown as { __sent: string[] }).__sent.push('setup-file-bundling-finished');
    });

    await evaluateModule(
      'globalThis.__sentAtEvaluation = globalThis.__sent.slice();\n__r(1);',
      'setup.ts',
    );

    expect(
      (globalThis as unknown as { __sentAtEvaluation: string[] }).__sentAtEvaluation,
    ).toEqual(['setup-file-bundling-finished']);
  });

  it('gives up the JS thread between chunks', async () => {
    const { plan } = await evaluateChunked();

    const macrotasks = new Set(globalThis.__order.map((entry) => entry.macrotask));
    // One task per chunk: other work (such as answering the harness) runs
    // in between.
    expect(macrotasks.size).toBe(plan.chunks.length);
  });

  it('reports stack frames at their position in the whole bundle', async () => {
    const { code, plan } = await evaluateChunked();
    // A module in a middle chunk, which carries no sourceURL of its own in
    // the bundle.
    const middleChunk = plan.chunks[Math.floor(plan.chunks.length / 2)];
    const moduleId = globalThis.__order
      .map((entry) => entry.module)
      .find((id) => code.indexOf(`module: ${id},`) >= middleChunk.start);

    if (moduleId === undefined) {
      throw new Error('expected a module in the middle chunk');
    }

    let thrown: unknown;
    try {
      globalThis.__throwers[moduleId]();
    } catch (error) {
      thrown = error;
    }

    expect(stackLineFor(thrown)).toBe(throwLineInBundle(code, moduleId));
  });
});
