import { describe, expect, it, vi } from 'vitest';

import { disableHMRWhenReady } from '../disableHMRWhenReady.js';

describe('initialize', () => {
  it('retries HMRClient.disable until setup is ready', async () => {
    vi.useFakeTimers();

    const disable = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Expected HMRClient.setup() call at startup.');
      })
      .mockImplementationOnce(() => {
        // ok
      });

    const promise = disableHMRWhenReady(disable, 50);
    await vi.runAllTimersAsync();
    await promise;

    expect(disable).toHaveBeenCalledTimes(2);
  });
});
