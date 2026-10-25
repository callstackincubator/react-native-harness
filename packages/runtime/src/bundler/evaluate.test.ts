import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateModule } from './evaluate.js';
import { MalformedModuleError } from './errors.js';

describe('evaluateModule', () => {
  const resetModule = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('__resetModule', resetModule);
    vi.stubGlobal('__r', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetModule.mockReset();
  });

  it('resets and evaluates a module addressed by a numeric id', async () => {
    await evaluateModule('globalThis.__evaluated = 1;\n__r(7);\n__r(42);', 'a.ts');

    expect(resetModule).toHaveBeenCalledWith(42);
  });

  it('accepts quoted string ids from custom module id factories', async () => {
    await evaluateModule('__r("1a273c231bb2d16a5322");', 'a.ts');

    expect(resetModule).toHaveBeenCalledWith('1a273c231bb2d16a5322');
  });

  it('rejects a bundle without a require call', async () => {
    await expect(evaluateModule('var x = 1;', 'a.ts')).rejects.toThrow(
      MalformedModuleError
    );
  });
});
