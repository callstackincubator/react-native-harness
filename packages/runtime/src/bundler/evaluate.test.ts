import { afterEach, describe, expect, it, vi } from 'vitest';
// `vi.mock` is hoisted above this import by Vitest.
import { evaluateModuleAsync } from './evaluate.js';

const mocks = vi.hoisted(() => ({
  handle: null as { setBusy: ReturnType<typeof vi.fn> } | null,
}));

vi.mock('../client/store.js', () => ({
  tryGetHandle: () => mocks.handle,
}));

const MODULE_JS = 'globalThis.__evaluated = (globalThis.__evaluated ?? 0) + 1; __r(0);';

afterEach(() => {
  mocks.handle = null;
  delete (globalThis as Record<string, unknown>).__evaluated;
  delete (globalThis as Record<string, unknown>).__resetModule;
  delete (globalThis as Record<string, unknown>).__r;
});

describe('evaluateModuleAsync', () => {
  it('announces the blocking phase before evaluating and clears it after', async () => {
    const setBusy = vi.fn();
    mocks.handle = { setBusy };
    (globalThis as Record<string, unknown>).__resetModule = vi.fn();
    (globalThis as Record<string, unknown>).__r = vi.fn();

    await evaluateModuleAsync(MODULE_JS, 'example.harness.tsx');

    expect((globalThis as Record<string, unknown>).__evaluated).toBe(1);
    expect(setBusy.mock.calls).toEqual([
      [true, 'evaluating example.harness.tsx'],
      [false],
    ]);
  });

  it('clears the blocking phase even when evaluation throws', async () => {
    const setBusy = vi.fn();
    mocks.handle = { setBusy };
    (globalThis as Record<string, unknown>).__resetModule = vi.fn();
    (globalThis as Record<string, unknown>).__r = vi.fn();

    await expect(
      evaluateModuleAsync('no require calls here', 'example.harness.tsx'),
    ).rejects.toThrow();

    expect(setBusy.mock.calls).toEqual([
      [true, 'evaluating example.harness.tsx'],
      [false],
    ]);
  });

  it('evaluates without a bridge handle', async () => {
    (globalThis as Record<string, unknown>).__resetModule = vi.fn();
    (globalThis as Record<string, unknown>).__r = vi.fn();

    await evaluateModuleAsync(MODULE_JS, 'example.harness.tsx');

    expect((globalThis as Record<string, unknown>).__evaluated).toBe(1);
  });
});
