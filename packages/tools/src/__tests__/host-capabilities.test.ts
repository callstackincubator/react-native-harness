import { describe, expect, it, vi } from 'vitest';

const osMocks = vi.hoisted(() => ({
  availableParallelism: vi.fn(),
  totalmem: vi.fn(),
}));

vi.mock('node:os', () => ({
  default: osMocks,
}));

import { getHostCapabilities } from '../host-capabilities.js';

describe('getHostCapabilities', () => {
  it('returns total memory and available CPU parallelism from Node', () => {
    osMocks.totalmem.mockReturnValue(16 * 1024 ** 3);
    osMocks.availableParallelism.mockReturnValue(10);

    expect(getHostCapabilities()).toEqual({
      totalMemoryBytes: 16 * 1024 ** 3,
      availableCpuCount: 10,
    });
  });
});
