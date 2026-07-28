import { describe, expect, it, vi } from 'vitest';

const totalmem = vi.fn();

vi.mock('node:os', () => ({
  totalmem: () => totalmem(),
}));

const { isLowMemoryHost, LOW_MEMORY_HOST_THRESHOLD_BYTES } = await import('../memory-budget.js');

describe('isLowMemoryHost', () => {
  it.each([
    [LOW_MEMORY_HOST_THRESHOLD_BYTES - 1, true],
    [LOW_MEMORY_HOST_THRESHOLD_BYTES, true],
    [LOW_MEMORY_HOST_THRESHOLD_BYTES + 1, false],
  ])('treats %i bytes of total memory as low-memory: %s', (bytes, expected) => {
    totalmem.mockReturnValue(bytes);

    expect(isLowMemoryHost()).toBe(expected);
  });
});
