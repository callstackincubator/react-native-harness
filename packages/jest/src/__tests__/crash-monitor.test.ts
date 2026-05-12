import { describe, expect, it, vi } from 'vitest';
import type {
  AppCrashDetails,
  AppMonitor,
  AppMonitorEvent,
  AppMonitorListener,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import {
  createCrashMonitor,
  CrashWatchCancelledError,
} from '../crash-monitor.js';
import { NativeCrashError } from '../errors.js';

const noop = () => undefined;
const resolveUndefined = async () => undefined;

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const createAppMonitorMock = () => {
  let registeredListener: AppMonitorListener | null = null;

  const monitor: AppMonitor = {
    start: vi.fn(resolveUndefined),
    stop: vi.fn(resolveUndefined),
    dispose: vi.fn(resolveUndefined),
    addListener: vi.fn((l: AppMonitorListener) => {
      registeredListener = l;
    }),
    removeListener: vi.fn((l: AppMonitorListener) => {
      if (registeredListener === l) registeredListener = null;
    }),
  };

  return {
    monitor,
    emit: (event: AppMonitorEvent) => registeredListener?.(event),
  };
};

const createPlatformRunnerMock = (
  isRunning = false,
  crashDetails: AppCrashDetails | null = null,
) =>
  ({
    isAppRunning: vi.fn(async () => isRunning),
    getCrashDetails: vi.fn(async () => crashDetails),
    startApp: vi.fn(resolveUndefined),
    restartApp: vi.fn(resolveUndefined),
    stopApp: vi.fn(resolveUndefined),
    dispose: vi.fn(resolveUndefined),
    createAppMonitor: vi.fn(),
  }) as unknown as HarnessPlatformRunner;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCrashMonitor', () => {
  describe('liveness', () => {
    it('starts not alive', () => {
      const { monitor } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      expect(cm.isAlive()).toBe(false);
    });

    it('becomes alive when the app starts', () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      emit({ type: 'app_started' });

      expect(cm.isAlive()).toBe(true);
    });

    it('becomes not alive after a confirmed crash', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      emit({ type: 'app_started' });
      const watch = cm.watch('test.ts', 'execution');
      watch.promise.catch(noop);

      emit({ type: 'app_exited', isConfirmed: true });
      await watch.promise.catch(noop);

      expect(cm.isAlive()).toBe(false);
    });
  });

  describe('watch', () => {
    it('promise rejects with NativeCrashError on confirmed app_exited', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      const watch = cm.watch('/test/example.ts', 'execution');
      watch.promise.catch(noop);
      emit({ type: 'app_exited', isConfirmed: true });

      await expect(watch.promise).rejects.toBeInstanceOf(NativeCrashError);
    });

    it('attributes the crash to the file and phase passed to watch()', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      const watch = cm.watch('/test/example.ts', 'startup');
      watch.promise.catch(noop);
      emit({ type: 'app_exited', isConfirmed: true });

      const error = await watch.promise.catch((e: NativeCrashError) => e);
      expect(error.testFilePath).toBe('/test/example.ts');
      expect(error.details.phase).toBe('startup');
    });

    it('settles the promise with CrashWatchCancelledError on cancel()', async () => {
      const { monitor } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      const watch = cm.watch('test.ts', 'execution');
      watch.cancel();

      await expect(watch.promise).rejects.toBeInstanceOf(CrashWatchCancelledError);
    });

    it('subsequent cancel() after crash is a no-op', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      const watch = cm.watch('test.ts', 'execution');
      watch.promise.catch(noop);
      emit({ type: 'app_exited', isConfirmed: true });

      await watch.promise.catch(noop);
      // Second cancel should not throw or cause issues.
      expect(() => watch.cancel()).not.toThrow();
    });
  });

  describe('unconfirmed events', () => {
    it('fires the crash if isAppRunning returns false', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const runner = createPlatformRunnerMock(false /* not running */);
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: runner });

      const watch = cm.watch('test.ts', 'execution');
      watch.promise.catch(noop);
      emit({ type: 'app_exited', isConfirmed: false });

      await expect(watch.promise).rejects.toBeInstanceOf(NativeCrashError);
    });

    it('does not fire if isAppRunning returns true', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const runner = createPlatformRunnerMock(true /* still running */);
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: runner });

      const watch = cm.watch('test.ts', 'execution');
      const settled = vi.fn();
      watch.promise.then(settled, settled);

      emit({ type: 'app_exited', isConfirmed: false });
      await new Promise((r) => setTimeout(r, 20));

      expect(settled).not.toHaveBeenCalled();
      watch.cancel();
    });

    it('fires on possible_crash when confirmed', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      const watch = cm.watch('test.ts', 'execution');
      watch.promise.catch(noop);
      emit({ type: 'possible_crash', isConfirmed: true });

      await expect(watch.promise).rejects.toBeInstanceOf(NativeCrashError);
    });
  });

  describe('crash detail enrichment', () => {
    it('merges initial and enriched crash details', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const runner = createPlatformRunnerMock(false, {
        processName: 'MyApp',
        signal: 'SIGSEGV',
        summary: 'Segmentation fault',
      });
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: runner });

      const watch = cm.watch('test.ts', 'execution');
      watch.promise.catch(noop);
      emit({ type: 'app_exited', isConfirmed: true, crashDetails: { pid: 1234 } });

      const error = await watch.promise.catch((e: NativeCrashError) => e);
      expect(error.details.processName).toBe('MyApp');
      expect(error.details.signal).toBe('SIGSEGV');
      expect(error.details.pid).toBe(1234);
    });
  });

  describe('stop / start', () => {
    it('ignores events while stopped', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      await cm.stop();

      const watch = cm.watch('test.ts', 'execution');
      const settled = vi.fn();
      watch.promise.then(settled, settled);

      emit({ type: 'app_exited', isConfirmed: true });
      await new Promise((r) => setTimeout(r, 10));

      expect(settled).not.toHaveBeenCalled();
      watch.cancel();
    });

    it('resumes monitoring after start()', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      await cm.stop();
      await cm.start();

      const watch = cm.watch('test.ts', 'execution');
      watch.promise.catch(noop);
      emit({ type: 'app_exited', isConfirmed: true });

      await expect(watch.promise).rejects.toBeInstanceOf(NativeCrashError);
    });
  });

  describe('reset', () => {
    it('clears alive state and pending watchers', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      emit({ type: 'app_started' });
      const watch = cm.watch('test.ts', 'execution');
      watch.promise.catch(noop);

      cm.reset();

      expect(cm.isAlive()).toBe(false);
      // The watcher was cleared; a crash fired now should not reach the old watch.
      emit({ type: 'app_exited', isConfirmed: true });
      await new Promise((r) => setTimeout(r, 10));

      // Old promise is still pending (we can verify by cancel resolving it).
      watch.cancel();
      await expect(watch.promise).rejects.toBeInstanceOf(CrashWatchCancelledError);
    });
  });

  describe('dispose', () => {
    it('ignores events after dispose', async () => {
      const { monitor, emit } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      const watch = cm.watch('test.ts', 'execution');
      watch.promise.catch(noop);

      await cm.dispose();

      emit({ type: 'app_exited', isConfirmed: true });
      await new Promise((r) => setTimeout(r, 10));

      // After dispose watchers are cleared, so crash didn't propagate.
      // The promise is still pending - cancel to settle it.
      watch.cancel();
      await expect(watch.promise).rejects.toBeInstanceOf(CrashWatchCancelledError);
    });

    it('calls appMonitor.dispose()', async () => {
      const { monitor } = createAppMonitorMock();
      const cm = createCrashMonitor({ appMonitor: monitor, platformRunner: createPlatformRunnerMock() });

      await cm.dispose();

      expect(monitor.dispose).toHaveBeenCalledOnce();
    });
  });
});
