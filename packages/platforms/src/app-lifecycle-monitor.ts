import { NativeCrashError, type NativeCrashDetails } from './errors.js';
import type { AppCrashDetails, AppLifecycleMonitor, AppLifecyclePhase } from './types.js';

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

export type ManagedCrashEvent = {
  details?: AppCrashDetails;
  fallbackSummary?: string;
  confirmed?: boolean;
};

export type CreateManagedAppLifecycleMonitorOptions = {
  startCollectors: () => Promise<void>;
  stopCollectors: () => Promise<void>;
  disposeCollectors?: () => Promise<void>;
  isAppRunning: () => Promise<boolean>;
  resolveCrashDetails?: (options: {
    processName?: string;
    pid?: number;
    occurredAt: number;
  }) => Promise<AppCrashDetails | null>;
  onReset?: () => void;
};

type ManagedMonitorReject = (error: Error) => void;

const mergeCrashDetails = (
  phase: AppLifecyclePhase,
  initial?: AppCrashDetails,
  enriched?: AppCrashDetails | null,
  fallbackSummary?: string,
): NativeCrashDetails => ({
  phase,
  platform: enriched?.platform ?? initial?.platform,
  kind: enriched?.kind ?? initial?.kind,
  confidence: enriched?.confidence ?? initial?.confidence,
  occurredAt: enriched?.occurredAt ?? initial?.occurredAt,
  launchId: enriched?.launchId ?? initial?.launchId,
  source: enriched?.source ?? initial?.source,
  summary: enriched?.summary ?? initial?.summary ?? fallbackSummary,
  signal: enriched?.signal ?? initial?.signal,
  exceptionType: enriched?.exceptionType ?? initial?.exceptionType,
  processName: enriched?.processName ?? initial?.processName,
  pid: enriched?.pid ?? initial?.pid,
  stackTrace: enriched?.stackTrace ?? initial?.stackTrace,
  rawLines: enriched?.rawLines ?? initial?.rawLines,
  artifactType: enriched?.artifactType ?? initial?.artifactType,
  artifactPath: enriched?.artifactPath ?? initial?.artifactPath,
});

export const createManagedAppLifecycleMonitor = ({
  startCollectors,
  stopCollectors,
  disposeCollectors,
  isAppRunning,
  resolveCrashDetails,
  onReset,
}: CreateManagedAppLifecycleMonitorOptions) => {
  let alive = false;
  let monitoring = true;
  let disposed = false;
  let resolvingCrash = false;
  let currentTestFilePath = '';
  let currentPhase: AppLifecyclePhase = 'startup';
  const watchers = new Set<ManagedMonitorReject>();

  const notifyCrash = (error: NativeCrashError) => {
    const pending = [...watchers];
    watchers.clear();

    for (const reject of pending) {
      reject(error);
    }
  };

  const handleCrash = async (
    phase: AppLifecyclePhase,
    details?: AppCrashDetails,
    fallbackSummary?: string,
  ) => {
    if (resolvingCrash) {
      return;
    }

    resolvingCrash = true;
    alive = false;

    try {
      const enriched = await resolveCrashDetails?.({
        processName: details?.processName,
        pid: details?.pid,
        occurredAt: Date.now(),
      });

      notifyCrash(
        new NativeCrashError(
          currentTestFilePath,
          mergeCrashDetails(phase, details, enriched, fallbackSummary),
        ),
      );
    } finally {
      resolvingCrash = false;
    }
  };

  const confirmAndHandleCrash = async (
    phase: AppLifecyclePhase,
    details?: AppCrashDetails,
    fallbackSummary?: string,
  ) => {
    if (disposed || !monitoring) {
      return;
    }

    try {
      if (!(await isAppRunning())) {
        void handleCrash(phase, details, fallbackSummary);
      }
    } catch {
      // Ignore best-effort confirmation failures; collectors may be racing teardown.
    }
  };

  const processCrashEvent = (event?: ManagedCrashEvent) => {
    if (disposed || !monitoring) {
      return;
    }

    if (event?.confirmed) {
      void handleCrash(currentPhase, event.details, event.fallbackSummary);
      return;
    }

    void confirmAndHandleCrash(currentPhase, event?.details, event?.fallbackSummary);
  };

  const monitor: AppLifecycleMonitor = {
    start: async () => {
      monitoring = true;
      await startCollectors();
    },
    stop: async () => {
      monitoring = false;
      await stopCollectors();
    },
    dispose: async () => {
      disposed = true;
      monitoring = false;
      alive = false;
      watchers.clear();
      resolvingCrash = false;
      await (disposeCollectors ?? stopCollectors)();
    },
    launchRequested: () => {
      alive = false;
    },
    launchCompleted: () => {
      alive = true;
    },
    launchFailed: () => {
      alive = false;
    },
    stopRequested: () => {
      alive = false;
    },
    stopCompleted: () => undefined,
    watch: (testFilePath, phase) => {
      currentTestFilePath = testFilePath;
      currentPhase = phase;
      let rejectFn!: ManagedMonitorReject;

      const promise = new Promise<never>((_, reject) => {
        rejectFn = (error) => {
          watchers.delete(rejectFn);
          reject(error);
        };
        watchers.add(rejectFn);
      });

      return {
        promise,
        cancel: () => {
          rejectFn(new CrashWatchCancelledError());
        },
      };
    },
    reset: () => {
      alive = false;
      resolvingCrash = false;
      currentTestFilePath = '';
      watchers.clear();
      onReset?.();
    },
    isAlive: () => alive,
  };

  return {
    monitor,
    appStarted: () => {
      if (!disposed && monitoring) {
        alive = true;
      }
    },
    appExited: (event?: ManagedCrashEvent) => {
      processCrashEvent({ ...event, confirmed: event?.confirmed ?? false });
    },
    possibleCrash: (event?: ManagedCrashEvent) => {
      processCrashEvent({ ...event, confirmed: event?.confirmed ?? false });
    },
  };
};
