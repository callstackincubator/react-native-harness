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

export type CrashSupervisorState =
  | 'idle'
  | 'launching'
  | 'ready'
  | 'running'
  | 'disposing';

export type CrashSupervisor = {
  setActiveTestFile: (testFilePath: string | null) => void;
  beginLaunch: (testFilePath: string) => void;
  markReady: () => void;
  beginTestRun: (testFilePath: string) => void;
  stop: () => Promise<void>;
  start: () => Promise<void>;
  waitForCrash: (testFilePath: string) => Promise<never>;
  isReady: () => boolean;
  cancelCrashWaiters: () => void;
  reset: () => void;
  dispose: () => Promise<void>;
};

export type CrashSupervisorOptions = {
  appMonitor: AppMonitor;
  platformRunner: HarnessPlatformRunner;
};

type CrashDetailsProvider = {
  getCrashDetails?: (
    options: {
      processName?: string;
      pid?: number;
      occurredAt: number;
    }
  ) => Promise<AppCrashDetails | null>;
};

const getCrashPhase = (state: CrashSupervisorState): NativeCrashPhase =>
  state === 'running' ? 'execution' : 'startup';

const mergeCrashDetails = (
  phase: NativeCrashPhase,
  initialDetails?: AppCrashDetails,
  enrichedDetails?: AppCrashDetails | null,
  fallbackSummary?: string
): NativeCrashDetails => ({
  phase,
  source: enrichedDetails?.source ?? initialDetails?.source,
  summary:
    enrichedDetails?.summary ?? initialDetails?.summary ?? fallbackSummary,
  signal: enrichedDetails?.signal ?? initialDetails?.signal,
  exceptionType: enrichedDetails?.exceptionType ?? initialDetails?.exceptionType,
  processName: enrichedDetails?.processName ?? initialDetails?.processName,
  pid: enrichedDetails?.pid ?? initialDetails?.pid,
  stackTrace: enrichedDetails?.stackTrace ?? initialDetails?.stackTrace,
  rawLines: enrichedDetails?.rawLines ?? initialDetails?.rawLines,
  artifactType: enrichedDetails?.artifactType ?? initialDetails?.artifactType,
  artifactPath: enrichedDetails?.artifactPath ?? initialDetails?.artifactPath,
});

export const createCrashSupervisor = ({
  appMonitor,
  platformRunner,
}: CrashSupervisorOptions): CrashSupervisor => {
  let state: CrashSupervisorState = 'idle';
  let activeTestFilePath: string | null = null;
  let crashRejectors = new Set<(error: NativeCrashError) => void>();
  let disposed = false;
  let monitoring = true;
  let isResolvingCrash = false;

  const getCrashDetailsProvider = (): CrashDetailsProvider | null => {
    if ('getCrashDetails' in appMonitor) {
      return appMonitor as AppMonitor & CrashDetailsProvider;
    }

    if (platformRunner.getCrashDetails) {
      return platformRunner;
    }

    return null;
  };

  const rejectCrashWaiters = (testFilePath: string, details: NativeCrashDetails) => {
    const error = new NativeCrashError(testFilePath, details);

    for (const reject of crashRejectors) {
      reject(error);
    }

    crashRejectors = new Set();
  };

  const handleCrash = async (reason: string, details?: AppCrashDetails) => {
    if (
      isResolvingCrash ||
      (state !== 'launching' && state !== 'running' && state !== 'ready')
    ) {
      return;
    }

    if (!activeTestFilePath) {
      logger.debug(`Ignoring crash signal without active test: ${reason}`);
      return;
    }

    isResolvingCrash = true;
    logger.debug(`Native crash detected during ${activeTestFilePath} (state: ${state}, reason: ${reason || '(none)'})`);

    for (const line of details?.rawLines ?? []) {
      logger.debug(line);
    }

    const phase = getCrashPhase(state);
    const testFilePath = activeTestFilePath;
    state = 'idle';

    try {
      const enrichedDetails = await getCrashDetailsProvider()?.getCrashDetails?.({
        processName: details?.processName,
        pid: details?.pid,
        occurredAt: Date.now(),
      });

      const mergedDetails = mergeCrashDetails(phase, details, enrichedDetails, reason);
      logger.debug('Crash details:', {
        phase: mergedDetails.phase,
        source: mergedDetails.source,
        summary: mergedDetails.summary,
        signal: mergedDetails.signal,
        exceptionType: mergedDetails.exceptionType,
        processName: mergedDetails.processName,
        pid: mergedDetails.pid,
      });
      rejectCrashWaiters(testFilePath, mergedDetails);
    } finally {
      isResolvingCrash = false;
    }
  };

  const confirmCrash = async (reason: string, details?: AppCrashDetails) => {
    if (disposed || !monitoring || state === 'disposing') {
      return;
    }

    try {
      const isRunning = await platformRunner.isAppRunning();

      if (!isRunning) {
        handleCrash(reason, details);
      }
    } catch (error) {
      logger.debug('Crash confirmation failed', error);
    }
  };

  const appMonitorListener: AppMonitorListener = (event: AppMonitorEvent) => {
    if (disposed || !monitoring) {
      return;
    }

    if (event.type === 'app_started') {
      return;
    }

    if (event.type === 'app_exited') {
      const details = {
        source: event.crashDetails?.source ?? event.source,
        summary: event.crashDetails?.summary,
        signal: event.crashDetails?.signal,
        exceptionType: event.crashDetails?.exceptionType,
        processName: event.crashDetails?.processName,
        pid: event.crashDetails?.pid ?? event.pid,
        stackTrace: event.crashDetails?.stackTrace,
        rawLines:
          event.crashDetails?.rawLines ??
          (event.line ? [event.line] : undefined),
      };

      if (event.isConfirmed ?? event.source === 'polling') {
        void handleCrash('', details);
      } else {
        void confirmCrash('', details);
      }
      return;
    }

    if (event.type === 'possible_crash') {
      const details = {
        source: event.crashDetails?.source ?? event.source,
        summary: event.crashDetails?.summary,
        signal: event.crashDetails?.signal,
        exceptionType: event.crashDetails?.exceptionType,
        processName: event.crashDetails?.processName,
        pid: event.crashDetails?.pid ?? event.pid,
        stackTrace: event.crashDetails?.stackTrace,
        rawLines:
          event.crashDetails?.rawLines ??
          (event.line ? [event.line] : undefined),
      };

      if (event.isConfirmed) {
        void handleCrash(
          `possible crash signal (${event.source ?? 'unknown'})`,
          details
        );
      } else {
        void confirmCrash(
          `possible crash signal (${event.source ?? 'unknown'})`,
          details
        );
      }
    }
  };

  appMonitor.addListener(appMonitorListener);

  const setActiveTestFile = (testFilePath: string | null) => {
    activeTestFilePath = testFilePath;
  };

  const beginLaunch = (testFilePath: string) => {
    activeTestFilePath = testFilePath;
    state = 'launching';
  };

  const markReady = () => {
    if (state !== 'disposing') {
      state = 'ready';
    }
  };

  const beginTestRun = (testFilePath: string) => {
    activeTestFilePath = testFilePath;
    state = 'running';
  };

  const stop = async () => {
    monitoring = false;
    await appMonitor.stop();
  };

  const start = async () => {
    monitoring = true;
    await appMonitor.start();
  };

  const waitForCrash = (testFilePath: string): Promise<never> =>
    new Promise<never>((_, reject) => {
      if (disposed) {
        reject(
          new NativeCrashError(testFilePath, {
            phase: 'startup',
            source: 'polling',
            summary: 'Crash supervisor disposed while waiting for app startup.',
          })
        );
        return;
      }

      crashRejectors.add(reject);
    });

  const isReady = () => state === 'ready' || state === 'running';

  const cancelCrashWaiters = () => {
    crashRejectors = new Set();
  };

  const reset = () => {
    cancelCrashWaiters();
    isResolvingCrash = false;
    if (state !== 'disposing') {
      state = 'idle';
    }
  };

  const dispose = async () => {
    disposed = true;
    monitoring = false;
    state = 'disposing';
    crashRejectors = new Set();
    isResolvingCrash = false;
    appMonitor.removeListener(appMonitorListener);
    await appMonitor.dispose();
  };

  return {
    setActiveTestFile,
    beginLaunch,
    markReady,
    beginTestRun,
    stop,
    start,
    waitForCrash,
    isReady,
    cancelCrashWaiters,
    reset,
    dispose,
  };
};
