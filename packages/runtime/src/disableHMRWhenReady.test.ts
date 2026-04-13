import { beforeEach, describe, expect, it, vi } from 'vitest';
import { disableHMRWhenReady } from './disableHMRWhenReady.js';

const mocks = vi.hoisted(() => ({
  Platform: { OS: 'android' },
}));

vi.mock('react-native', () => ({
  Platform: mocks.Platform,
}));

describe('disableHMRWhenReady', () => {
  beforeEach(() => {
    mocks.Platform.OS = 'android';
  });

  it('resolves when HMR setup never becomes available', async () => {
    const disable = vi.fn(() => {
      throw new Error('Expected HMRClient.setup() call at startup.');
    });

    await expect(disableHMRWhenReady(disable, 2, 0)).resolves.toBeUndefined();
    expect(disable).toHaveBeenCalledTimes(3);
  });

  it('rejects unexpected disable errors', async () => {
    const error = new Error('boom');
    const disable = vi.fn(() => {
      throw error;
    });

    await expect(disableHMRWhenReady(disable, 2, 0)).rejects.toBe(error);
  });

  it('skips disabling HMR on web', async () => {
    mocks.Platform.OS = 'web';
    const disable = vi.fn();

    await expect(disableHMRWhenReady(disable, 2, 0)).resolves.toBeUndefined();
    expect(disable).not.toHaveBeenCalled();
  });
});
