import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getHostCapabilities: vi.fn(),
  isCI: vi.fn(),
}));

vi.mock('@react-native-harness/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-native-harness/tools')>()),
  getHostCapabilities: mocks.getHostCapabilities,
  isCI: mocks.isCI,
}));

import {
  getDefaultXCTestAgentTickIntervalMs,
  shouldDeferMetroPrewarmUntilBooted,
  shouldOverlapXCTestBuildAndSimulatorBoot,
  shouldSlimSimulator,
  shouldWaitForSimulatorToSettle,
} from '../startup-strategy.js';

describe('shouldOverlapXCTestBuildAndSimulatorBoot', () => {
  it.each([
    [false, 8 * 1024 ** 3, 7],
    [false, 9 * 1024 ** 3, 6],
    [true, 9 * 1024 ** 3, 7],
  ])(
    'returns %s when memory is %i bytes and CPU count is %i',
    (expected, totalMemoryBytes, availableCpuCount) => {
      mocks.getHostCapabilities.mockReturnValue({
        totalMemoryBytes,
        availableCpuCount,
      });

      expect(shouldOverlapXCTestBuildAndSimulatorBoot()).toBe(expected);
    },
  );
});

describe('shouldWaitForSimulatorToSettle', () => {
  it.each([
    [true, 7 * 1024 ** 3, 3],
    [true, 16 * 1024 ** 3, 6],
    [false, 16 * 1024 ** 3, 8],
  ])('returns %s for %i bytes and %i CPUs', (expected, mem, cpus) => {
    mocks.getHostCapabilities.mockReturnValue({
      totalMemoryBytes: mem,
      availableCpuCount: cpus,
    });
    expect(shouldWaitForSimulatorToSettle()).toBe(expected);
  });
});

describe('getDefaultXCTestAgentTickIntervalMs', () => {
  it.each([
    [2000, 7 * 1024 ** 3, 3],
    [2000, 16 * 1024 ** 3, 6],
    [undefined, 16 * 1024 ** 3, 8],
  ])('returns %s for %i bytes and %i CPUs', (expected, mem, cpus) => {
    mocks.getHostCapabilities.mockReturnValue({
      totalMemoryBytes: mem,
      availableCpuCount: cpus,
    });
    expect(getDefaultXCTestAgentTickIntervalMs()).toBe(expected);
  });
});

describe('shouldDeferMetroPrewarmUntilBooted', () => {
  it.each([
    [true, 7 * 1024 ** 3, 3],
    [true, 16 * 1024 ** 3, 3],
    [true, 7 * 1024 ** 3, 8],
    [false, 8 * 1024 ** 3, 4],
    [false, 16 * 1024 ** 3, 8],
  ])('returns %s for %i bytes and %i CPUs', (expected, mem, cpus) => {
    mocks.getHostCapabilities.mockReturnValue({
      totalMemoryBytes: mem,
      availableCpuCount: cpus,
    });
    expect(shouldDeferMetroPrewarmUntilBooted()).toBe(expected);
  });
});

describe('shouldSlimSimulator', () => {
  const SMALL_HOST = { totalMemoryBytes: 7 * 1024 ** 3, availableCpuCount: 3 };
  const LARGE_HOST = { totalMemoryBytes: 32 * 1024 ** 3, availableCpuCount: 12 };

  it.each([
    [true, true, SMALL_HOST, undefined],
    [false, true, LARGE_HOST, undefined],
    [false, false, SMALL_HOST, undefined],
    [true, true, LARGE_HOST, true],
    [false, true, SMALL_HOST, false],
    [false, false, SMALL_HOST, true],
  ])(
    'returns %s on CI=%s for %o with slimOnCI=%s',
    (expected, ci, host, slimOnCI) => {
      mocks.isCI.mockReturnValue(ci);
      mocks.getHostCapabilities.mockReturnValue(host);
      expect(shouldSlimSimulator(slimOnCI)).toBe(expected);
    }
  );
});
