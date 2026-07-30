import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getHostCapabilities: vi.fn(),
}));

vi.mock('@react-native-harness/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-native-harness/tools')>()),
  getHostCapabilities: mocks.getHostCapabilities,
}));

import { shouldOverlapXCTestBuildAndSimulatorBoot } from '../startup-strategy.js';

describe('shouldOverlapXCTestBuildAndSimulatorBoot', () => {
  it.each([
    [8 * 1024 ** 3, 7, false],
    [9 * 1024 ** 3, 6, false],
    [9 * 1024 ** 3, 7, true],
  ])(
    'returns %s for %i bytes of memory and %i CPUs',
    (totalMemoryBytes, availableCpuCount, expected) => {
      mocks.getHostCapabilities.mockReturnValue({
        totalMemoryBytes,
        availableCpuCount,
      });

      expect(shouldOverlapXCTestBuildAndSimulatorBoot()).toBe(expected);
    },
  );
});
