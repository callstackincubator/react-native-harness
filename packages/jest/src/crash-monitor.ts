import {
  type AppMonitor,
  type AppCrashDetails,
  type AppMonitorEvent,
  type AppMonitorListener,
  type HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import {
  NativeCrashError,
  type NativeCrashDetails,
  type NativeCrashPhase,
} from './errors.js';
import { logger } from '@react-native-harness/tools';

const crashLogger = logger.child('crash');

export class CrashWatchCancelledError extends Error {
  constructor() {
    super('Crash watch was cancelled');
    this.name = 'CrashWatchCancelledError';
  }
}

export type CrashWatch = {
  readonly promise: Promise<never>;
  cancel: () => void;
};

export type CrashMonitor = {
  watch: (testFilePath: string, phase: NativeCrashPhase) => CrashWatch;
  isAlive: () => boolean;
  stop: () => Promise<void>;
  start: () => Promise<void>;
  reset: () => void;
  dispose: () => Promise<void>;
};

export type CrashMonitorOptions = {
  appMonitor: AppMonitor;
  platformRunner: HarnessPlatformRunner;
};

type CrashDetailsProvider = {
  getCrashDetails?: (options: {
    processName?: string;
    pid?: number;
    occurredAt: number;
  }) => Promise<AppCrashDetails | null>;
};

const mergeCrashDetails = (
  phase: NativeCrashPhase,
  initial?: AppCrashDetails,
  enriched?: AppCrashDetails | null,
  fallbackSummary?: string,
): NativeCrashDetails => ({
  phase,
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

export const createCrashMonitor = ({
  appMonitor,
  platformRunner,
}: CrashMonitorOptions): CrashMonitor => {
  let alive = false;
  let monitoring = true;
  let isResolvingCrash = false;
  let disposed = false;

  // Both updated when watch() is called so crashes are attributed to the
  // correct test file and lifecycle phase.
  let currentTestFilePath = '';
  let currentPhase: NativeCrashPhase = 'startup';
  const watchers = new Set<(err: NativeCrashError) => void>();

  const getCrashDetailsProvider = (): CrashDetailsProvider | null => {
    if ('getCrashDetails' in appMonitor) {
      return appMonitor as AppMonitor & CrashDetailsProvider;
    }
    if (platformRunner.getCrashDetails) {
      return platformRunner;
    }
    return null;
  };

  const notifyCrash = (err: NativeCrashError) => {
    const pending = [...watchers];
    watchers.clear();
    for (const fn of pending) fn(err);
  };

  const handleCrash = async (
    phase: NativeCrashPhase,
    details?: AppCrashDetails,
    fallbackSummary?: string,
  ) => {
    if (isResolvingCrash) return;
    isResolvingCrash = true;
    alive = false;

    crashLogger.debug('native crash detected (phase=%s)', phase);
    for (const line of details?.rawLines ?? []) {
      crashLogger.debug('%s', line);
    }

    try {
      const enriched = await getCrashDetailsProvider()?.getCrashDetails?.({
        processName: details?.processName,
        pid: details?.pid,
        occurredAt: Date.now(),
      });
      const merged = mergeCrashDetails(phase, details, enriched, fallbackSummary);
      crashLogger.debug('crash details: %o', {
        phase: merged.phase,
        source: merged.source,
        summary: merged.summary,
        signal: merged.signal,
        exceptionType: merged.exceptionType,
        processName: merged.processName,
        pid: merged.pid,
      });
      notifyCrash(new NativeCrashError(currentTestFilePath, merged));
    } finally {
      isResolvingCrash = false;
    }
  };

  const confirmAndHandleCrash = async (
    phase: NativeCrashPhase,
    details?: AppCrashDetails,
    fallbackSummary?: string,
  ) => {
    if (disposed || !monitoring) return;
    try {
      const isRunning = await platformRunner.isAppRunning();
      if (!isRunning) {
        void handleCrash(phase, details, fallbackSummary);
      }
    } catch (error) {
      crashLogger.debug('crash confirmation failed', error);
    }
  };

  const extractCrashDetails = (
    event: Extract<AppMonitorEvent, { type: 'app_exited' | 'possible_crash' }>,
  ): AppCrashDetails | undefined =>
    event.crashDetails
      ? {
          source: event.crashDetails.source ?? event.source,
          summary: event.crashDetails.summary,
          signal: event.crashDetails.signal,
          exceptionType: event.crashDetails.exceptionType,
          processName: event.crashDetails.processName,
          pid: event.crashDetails.pid ?? event.pid,
          stackTrace: event.crashDetails.stackTrace,
          rawLines:
            event.crashDetails.rawLines ??
            (event.line ? [event.line] : undefined),
        }
      : undefined;

  const appMonitorListener: AppMonitorListener = (event: AppMonitorEvent) => {
    if (disposed || !monitoring) return;

    if (event.type === 'app_started') {
      alive = true;
      return;
    }

    if (event.type === 'app_exited') {
      const details = extractCrashDetails(event);
      if (event.isConfirmed ?? event.source === 'polling') {
        void handleCrash(currentPhase, details);
      } else {
        void confirmAndHandleCrash(currentPhase, details);
      }
      return;
    }

    if (event.type === 'possible_crash') {
      const details = extractCrashDetails(event);
      const fallback = `possible crash signal (${event.source ?? 'unknown'})`;
      if (event.isConfirmed) {
        void handleCrash(currentPhase, details, fallback);
      } else {
        void confirmAndHandleCrash(currentPhase, details, fallback);
      }
    }
  };

  appMonitor.addListener(appMonitorListener);

  const watch = (testFilePath: string, phase: NativeCrashPhase): CrashWatch => {
    currentTestFilePath = testFilePath;
    currentPhase = phase;
    let rejectFn!: (err: Error) => void;

    const promise = new Promise<never>((_, reject) => {
      rejectFn = (err) => {
        watchers.delete(rejectFn);
        reject(err);
      };
      watchers.add(rejectFn);
    });

    const cancel = () => {
      rejectFn(new CrashWatchCancelledError());
    };

    return { promise, cancel };
  };

  return {
    watch,
    isAlive: () => alive,
    stop: async () => {
      monitoring = false;
      await appMonitor.stop();
    },
    start: async () => {
      monitoring = true;
      await appMonitor.start();
    },
    reset: () => {
      alive = false;
      watchers.clear();
      isResolvingCrash = false;
      currentTestFilePath = '';
    },
    dispose: async () => {
      disposed = true;
      monitoring = false;
      watchers.clear();
      isResolvingCrash = false;
      appMonitor.removeListener(appMonitorListener);
      await appMonitor.dispose();
    },
  };
};
