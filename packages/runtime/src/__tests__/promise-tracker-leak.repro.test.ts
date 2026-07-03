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

/**
 * Reproduces the harness node-process OOM brief:
 * https://.local/docs/react-native-harness-oom-brief.md
 *
 * A component that keeps the app busy (auto-playing view / rAF loop / async
 * data-binding) creates a stream of promises. Any promise that never settles
 * (abandoned / superseded async work, which is extremely common in a per-frame
 * render loop) is retained forever by the promise tracker, together with a
 * captured stack string. The tracker is a process-global singleton that is
 * installed once and NEVER cleared between tests or test files, so the buffer
 * grows monotonically for the whole run -> heap exhaustion.
 */
describe('promise-tracker leak repro (OOM brief)', () => {
  it('retains every never-settled promise and never drains across test files', () => {
    installPromiseTracker();

    const FILES = 30;
    const PROMISES_PER_FILE = 1000;

    for (let file = 0; file < FILES; file++) {
      // installPromiseTracker() is called again at the start of every runTests()
      // invocation on the device, but it is idempotent and does NOT reset the
      // accumulated records.
      installPromiseTracker();

      for (let i = 0; i < PROMISES_PER_FILE; i++) {
        // Continuous bridge/async work that is abandoned before it settles.
        void new Promise(() => undefined);
      }
    }

    const created = FILES * PROMISES_PER_FILE;
    const pending = getPendingPromises();

    // Before the fix this retained all `created` records (each with a captured
    // stack string) forever -> linear heap growth -> OOM. The tracker must now
    // stay bounded regardless of how many abandoned promises the app creates.
    expect(created).toBeGreaterThan(pending.length);
    expect(pending.length).toBeLessThanOrEqual(MAX_TRACKED_PROMISES);
  });
});
