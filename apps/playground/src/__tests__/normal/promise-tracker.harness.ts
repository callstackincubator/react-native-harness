import {
  describe,
  expect,
  getPendingPromises,
  test,
} from 'react-native-harness';

const PROMISE_COUNT = 50_000;

const getGc = (): (() => void) | undefined =>
  (globalThis as typeof globalThis & { gc?: () => void }).gc;

const waitForFinalizers = async (baseline: number, gc: () => void) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (getPendingPromises().length <= baseline) {
      return;
    }

    gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('Promise tracker', () => {
  test('reclaims abandoned promises after garbage collection', async (context) => {
    const gc = getGc();

    if (!gc) {
      context.skip('gc global is not available in this runtime');
      return;
    }

    const baseline = getPendingPromises().length;

    for (let i = 0; i < PROMISE_COUNT; i++) {
      void new Promise(() => undefined);
    }

    await waitForFinalizers(baseline, gc);

    expect(getPendingPromises().length).toBeLessThanOrEqual(baseline);
  });
});
