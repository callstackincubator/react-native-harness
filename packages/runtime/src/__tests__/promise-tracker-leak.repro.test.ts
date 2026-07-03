import { afterEach, describe, expect, it } from 'vitest';
import {
  getPendingPromises,
  installPromiseTracker,
  MAX_TRACKED_PROMISES,
  uninstallPromiseTracker,
} from '../promise-tracker.js';

afterEach(() => {
  uninstallPromiseTracker();
});

// Regression guard for the OOM caused by never-settling promises (e.g. abandoned
// per-frame async work in a busy app) accumulating in the tracker unbounded.
describe('promise-tracker leak repro', () => {
  it('stays bounded across test files instead of retaining every promise', () => {
    const FILES = 30;
    const PROMISES_PER_FILE = 1000;

    for (let file = 0; file < FILES; file++) {
      // Idempotent and does NOT reset accumulated records, so records leak across
      // files just as they do on the device where it runs once per runTests().
      installPromiseTracker();

      for (let i = 0; i < PROMISES_PER_FILE; i++) {
        void new Promise(() => undefined);
      }
    }

    const created = FILES * PROMISES_PER_FILE;
    const pending = getPendingPromises();

    expect(created).toBeGreaterThan(pending.length);
    expect(pending.length).toBeLessThanOrEqual(MAX_TRACKED_PROMISES);
  });
});
