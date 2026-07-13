import { describe, expect, it } from 'vitest';
import {
  getDeviceCoreBudget,
  MAX_DEVICE_CORE_BUDGET,
  MIN_DEVICE_CORE_BUDGET,
} from '../device-core-budget.js';

describe('getDeviceCoreBudget', () => {
  it('documents the supported device-core range', () => {
    expect(MIN_DEVICE_CORE_BUDGET).toBe(2);
    expect(MAX_DEVICE_CORE_BUDGET).toBe(4);
  });

  it.each([
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
    [7, 3],
    [8, 4],
    [32, 4],
  ])('allocates %i host cores as a %i-core device budget', (host, expected) => {
    expect(getDeviceCoreBudget(host)).toBe(expected);
  });
});
