import type { Config } from 'jest-runner';
import {
  createHarnessSession,
  type HarnessSession,
} from './harness-session.js';

// Jest constructs a new runner (and scheduler) for every watch-mode run, so a
// per-instance session would leave the previous run's session holding the
// resource lock while the next run queues behind it. Watch-mode sessions
// therefore live at module scope and are shared by all runner instances.
//
// There is no explicit teardown here: in interactive watch mode Jest exits
// via process.exit on Ctrl-C / `q`, which does not dispose the session. The
// lock is reclaimed by the lock manager's pid / stale-owner detection.
type WatchSessionEntry = {
  key: string;
  promise: Promise<HarnessSession>;
};

let current: WatchSessionEntry | null = null;

// Everything createHarnessSession reads from the Jest config.
const getSessionKey = (globalConfig: Config.GlobalConfig): string =>
  JSON.stringify([globalConfig.rootDir, Boolean(globalConfig.collectCoverage)]);

export const getWatchSession = (
  globalConfig: Config.GlobalConfig
): Promise<HarnessSession> => {
  const key = getSessionKey(globalConfig);

  if (current?.key === key) {
    return current.promise;
  }

  const stale = current;
  // The entry is installed synchronously so concurrent callers share it, even
  // while a stale session is still being disposed.
  const entry: WatchSessionEntry = {
    key,
    promise: (async () => {
      if (stale) {
        // A failed disposal must not fail the run.
        await stale.promise
          .then((session) => session.dispose())
          .catch(() => undefined);
      }
      return createHarnessSession(globalConfig);
    })(),
  };
  current = entry;

  // Never cache a failed creation; the next run retries.
  entry.promise.catch(() => {
    if (current === entry) {
      current = null;
    }
  });

  return entry.promise;
};

/** @internal Test-only: forget the module-level session without disposing. */
export const resetWatchSessionForTests = (): void => {
  current = null;
};
