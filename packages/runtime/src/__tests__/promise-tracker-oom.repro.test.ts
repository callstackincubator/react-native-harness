import { describe, expect, it } from 'vitest';
import {
  getPendingPromises,
  installPromiseTracker,
} from '../promise-tracker.js';

/**
 * Opt-in OOM reproduction for the harness node-process OOM brief.
 *
 * Run with a low heap cap and the opt-in flag to watch the retained
 * promise-tracker records exhaust the JS heap, exactly like the brief:
 *
 *   NODE_OPTIONS="--max-old-space-size=256" RN_HARNESS_OOM_REPRO=1 \
 *     pnpm exec vitest run --pool=forks \
 *     packages/runtime/src/__tests__/promise-tracker-oom.repro.test.ts
 *
 * Without the fix this prints a linear RSS climb and then dies with
 * "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of
 * memory". With a bounded tracker RSS plateaus and the loop completes.
 */
describe('promise-tracker OOM repro (opt-in)', () => {
  it.skipIf(!process.env.RN_HARNESS_OOM_REPRO)(
    'exhausts the heap with retained never-settled promises',
    () => {
      installPromiseTracker();

      const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
      const startRss = rssMb();

      for (let batch = 0; batch < 500; batch++) {
        for (let i = 0; i < 10_000; i++) {
          void new Promise(() => undefined);
        }
        if (batch % 5 === 0) {
          process.stderr.write(
            `batch=${batch} retained=${getPendingPromises().length} rss=${rssMb()}MB (+${rssMb() - startRss})\n`,
          );
        }
      }

      expect(getPendingPromises().length).toBeGreaterThan(0);
    },
  );
});
