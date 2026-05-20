import type { AppLifecycleMonitor } from './types.js';

export class CrashWatchCancelledError extends Error {
  constructor() {
    super('Crash watch was cancelled');
    this.name = 'CrashWatchCancelledError';
  }
}

export const createNoopAppLifecycleMonitor = (): AppLifecycleMonitor => ({
  start: async () => undefined,
  stop: async () => undefined,
  dispose: async () => undefined,
  launchRequested: () => undefined,
  launchCompleted: () => undefined,
  launchFailed: () => undefined,
  stopRequested: () => undefined,
  stopCompleted: () => undefined,
  watch: () => ({
    promise: new Promise<never>(() => undefined),
    cancel: () => undefined,
  }),
  reset: () => undefined,
  isAlive: () => true,
});
