import { describe, expect, it } from 'vitest';
import { resolveResetStrategyKind } from '../environment-reset.js';

describe('resolveResetStrategyKind', () => {
  it('normalizes true to the process strategy', () => {
    expect(resolveResetStrategyKind(true)).toBe('process');
  });

  it('normalizes false to null (no reset)', () => {
    expect(resolveResetStrategyKind(false)).toBeNull();
  });

  it('passes through the process string value', () => {
    expect(resolveResetStrategyKind('process')).toBe('process');
  });

  it('passes through the runtime string value', () => {
    expect(resolveResetStrategyKind('runtime')).toBe('runtime');
  });
});
