import { describe, expect, it } from 'vitest';
import { waitForSimulatorToSettle } from '../simulator-settle.js';

const setup = (durations: Array<number | 'error'>) => {
  let clock = 0;
  let i = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    probe: async () => {
      const d = durations[Math.min(i++, durations.length - 1)];
      if (d === 'error') {
        clock += 10;
        throw new Error('boom');
      }
      clock += d;
    },
  };
};

describe('waitForSimulatorToSettle', () => {
  it('settles after two consecutive fast probes', async () => {
    const result = await waitForSimulatorToSettle(setup([50, 60]));
    expect(result).toMatchObject({ settled: true, probes: 2 });
  });

  it('resets the streak on slow or failing probes', async () => {
    const result = await waitForSimulatorToSettle(
      setup([50, 900, 50, 'error', 50, 50]),
    );
    expect(result).toMatchObject({ settled: true, probes: 6 });
  });

  it('returns without throwing when the cap is reached', async () => {
    const result = await waitForSimulatorToSettle({
      ...setup(['error']),
      maxWaitMs: 2_000,
    });
    expect(result.settled).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(2_000);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await waitForSimulatorToSettle({
      ...setup([50]),
      signal: controller.signal,
    });
    expect(result).toMatchObject({ settled: false, probes: 0 });
  });
});
