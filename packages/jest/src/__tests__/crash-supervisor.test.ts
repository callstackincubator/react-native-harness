import { describe, expect, it, vi } from 'vitest';
import {
  type AppMonitor,
  type AppCrashDetails,
  type AppMonitorEvent,
  type AppMonitorListener,
  type HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import { createCrashSupervisor } from '../crash-supervisor.js';

type MockCrashDetailsGetter = (
  options: {
    processName?: string;
    pid?: number;
    occurredAt: number;
  }
) => Promise<AppCrashDetails | null>;

const createMockAppMonitor = (options?: {
  getCrashDetails?: MockCrashDetailsGetter;
}) => {
  const listeners = new Set<AppMonitorListener>();
  const noop = async () => undefined;

  const appMonitor: AppMonitor & {
    getCrashDetails?: MockCrashDetailsGetter;
  } = {
    start: noop,
    stop: noop,
    dispose: noop,
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    },
  };

  if (options?.getCrashDetails) {
    appMonitor.getCrashDetails = options.getCrashDetails;
  }

  const emit = (event: AppMonitorEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  return {
    appMonitor,
    emit,
  };
};

const createPlatformRunner = ({
  isAppRunning,
  getCrashDetails,
}: {
  isAppRunning: () => Promise<boolean>;
  getCrashDetails?: HarnessPlatformRunner['getCrashDetails'];
}): HarnessPlatformRunner => ({
  startApp: async () => undefined,
  restartApp: async () => undefined,
  stopApp: async () => undefined,
  dispose: async () => undefined,
  isAppRunning,
  createAppMonitor: () => {
    throw new Error('Not used in unit tests');
  },
  getCrashDetails,
});

describe('crash-supervisor', () => {
  it('rejects the active test when the app exits during launch', async () => {
    const monitor = createMockAppMonitor();
    const supervisor = createCrashSupervisor({
      appMonitor: monitor.appMonitor,
      platformRunner: createPlatformRunner({
        isAppRunning: vi.fn().mockResolvedValue(false),
      }),
    });

    supervisor.beginLaunch('/tmp/startup.harness.ts');

    const crashPromise = supervisor.waitForCrash('/tmp/startup.harness.ts');
    const expectation =
      expect(crashPromise).rejects.toMatchObject({
        name: 'NativeCrashError',
        phase: 'startup',
        details: {
          signal: 'SIGSEGV',
          processName: 'com.harnessplayground',
        },
      });
    monitor.emit({
      type: 'app_exited',
      source: 'logs',
      crashDetails: {
        source: 'logs',
        signal: 'SIGSEGV',
        processName: 'com.harnessplayground',
        rawLines: ['Fatal signal 11 (SIGSEGV)'],
      },
    });

    await expectation;
    await supervisor.dispose();
  });

  it('treats polling exit events as immediately confirmed crashes', async () => {
    const monitor = createMockAppMonitor();
    const isAppRunning = vi.fn().mockResolvedValue(true);
    const supervisor = createCrashSupervisor({
      appMonitor: monitor.appMonitor,
      platformRunner: createPlatformRunner({
        isAppRunning,
      }),
    });

    supervisor.beginLaunch('/tmp/polling-exit.harness.ts');

    const crashPromise = supervisor.waitForCrash('/tmp/polling-exit.harness.ts');
    monitor.emit({ type: 'app_exited', source: 'polling' });

    await expect(crashPromise).rejects.toMatchObject({
      name: 'NativeCrashError',
      phase: 'startup',
    });
    expect(isAppRunning).not.toHaveBeenCalled();
    await supervisor.dispose();
  });

  it('does not reject when monitoring is stopped', async () => {
    const monitor = createMockAppMonitor();
    const supervisor = createCrashSupervisor({
      appMonitor: monitor.appMonitor,
      platformRunner: createPlatformRunner({
        isAppRunning: vi.fn().mockResolvedValue(false),
      }),
    });

    supervisor.beginTestRun('/tmp/restart.harness.ts');
    await supervisor.stop();

    const reject = vi.fn();
    void supervisor.waitForCrash('/tmp/restart.harness.ts').catch(reject);

    monitor.emit({ type: 'app_exited', source: 'polling' });
    await Promise.resolve();

    expect(reject).not.toHaveBeenCalled();
    await supervisor.dispose();
  });

  it('prefers crash details from the started app monitor over the runner', async () => {
    const monitorGetCrashDetails = vi.fn().mockResolvedValue({
      source: 'logs',
      summary: 'full crash block',
      rawLines: ['full crash block'],
    });
    const runnerGetCrashDetails = vi.fn().mockResolvedValue({
      source: 'logs',
      summary: 'runner details',
      rawLines: ['runner details'],
    });
    const monitor = createMockAppMonitor({
      getCrashDetails: monitorGetCrashDetails,
    });
    const supervisor = createCrashSupervisor({
      appMonitor: monitor.appMonitor,
      platformRunner: createPlatformRunner({
        isAppRunning: vi.fn().mockResolvedValue(false),
        getCrashDetails: runnerGetCrashDetails,
      }),
    });

    supervisor.beginTestRun('/tmp/monitor-details.harness.ts');

    const crashPromise = supervisor.waitForCrash('/tmp/monitor-details.harness.ts');
    monitor.emit({
      type: 'possible_crash',
      source: 'logs',
      crashDetails: {
        source: 'logs',
        processName: 'com.harnessplayground',
        pid: 1234,
        rawLines: ['partial line'],
      },
    });

    await expect(crashPromise).rejects.toMatchObject({
      details: {
        summary: 'full crash block',
      },
    });
    expect(monitorGetCrashDetails).toHaveBeenCalled();
    expect(runnerGetCrashDetails).not.toHaveBeenCalled();
    await supervisor.dispose();
  });
});
