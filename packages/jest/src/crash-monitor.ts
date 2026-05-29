import {
  type AppCrashDetails,
  type AppSession,
  type AppSessionEvent,
  type AppSessionListener,
  type AppSessionLog,
  type AppSessionState,
} from '@react-native-harness/platforms';
import {
  NativeCrashError,
  RuntimeDisconnectError,
  type HarnessRuntimeFailure,
  type NativeCrashDetails,
  type NativeCrashPhase,
  type RuntimeDisconnectDetails,
} from './errors.js';
import { logger } from '@react-native-harness/tools';

const crashLogger = logger.child('crash');
const CRASH_CLASSIFICATION_SETTLE_MS = 1500;
const CRASH_LOG_WINDOW_MS = 3000;

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
  setAppSession: (session: AppSession | null) => void;
  handleBridgeDisconnect: () => void;
  dispose: () => Promise<void>;
};

export type CrashMonitorOptions = {
  appSession?: AppSession | null;
};

type PendingCrash = {
  testFilePath: string;
  phase: NativeCrashPhase;
  occurredAt: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isCrashIndicator = (line: string) =>
  /uncaught exception|terminating app due to|fatal error|EXC_[A-Z_]+|termination reason|crash|abort/i.test(
    line
  ) || /\bSIG[A-Z]{2,}\b/.test(line);

const getMatchingCrashLines = (
  logs: AppSessionLog[],
  occurredAt: number
): string[] =>
  logs
    .filter(
      (log) => Math.abs(log.occurredAt - occurredAt) <= CRASH_LOG_WINDOW_MS
    )
    .map((log) => log.line)
    .filter(isCrashIndicator);

const buildNativeCrashDetails = (
  phase: NativeCrashPhase,
  rawLines: string[],
  summary: string
): NativeCrashDetails => ({
  phase,
  source: rawLines.length > 0 ? 'logs' : 'bridge',
  summary: rawLines.length > 0 ? rawLines.join('\n') : summary,
  rawLines: rawLines.length > 0 ? rawLines : undefined,
});

const getStatePid = (state: AppSessionState | undefined) => {
  if (state && 'pid' in state) {
    return state.pid;
  }

  return undefined;
};

const mergeCrashDetails = (
  fallback: NativeCrashDetails,
  extracted: AppCrashDetails | null
): NativeCrashDetails => {
  if (!extracted) {
    return fallback;
  }

  return {
    ...fallback,
    ...extracted,
    phase: fallback.phase,
    source: extracted.source ?? fallback.source,
    summary: extracted.summary ?? fallback.summary,
    rawLines: extracted.rawLines ?? fallback.rawLines,
  };
};

const buildRuntimeDisconnectDetails = (
  phase: NativeCrashPhase,
  rawLines: string[]
): RuntimeDisconnectDetails => ({
  phase,
  source: 'bridge',
  summary:
    'The runtime bridge disconnected, but the app session still appears to be running.',
  rawLines: rawLines.length > 0 ? rawLines : undefined,
});

export const createCrashMonitor = ({
  appSession: initialAppSession = null,
}: CrashMonitorOptions = {}): CrashMonitor => {
  let alive = false;
  let monitoring = true;
  let isResolvingCrash = false;
  let disposed = false;
  let appSession: AppSession | null = null;
  let pendingTimer: NodeJS.Timeout | null = null;

  let currentTestFilePath = '';
  let currentPhase: NativeCrashPhase = 'startup';
  const watchers = new Set<(err: HarnessRuntimeFailure) => void>();

  const notifyFailure = (err: HarnessRuntimeFailure) => {
    const pending = [...watchers];
    watchers.clear();
    for (const fn of pending) fn(err);
  };

  const clearPendingTimer = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const classify = async (
    pending: PendingCrash,
    trigger: 'bridge-disconnect' | 'app-exit'
  ) => {
    if (disposed || !monitoring || isResolvingCrash) {
      return;
    }

    isResolvingCrash = true;

    try {
      const session = appSession;
      const state = await session?.getState();
      const logs = session?.getLogs() ?? [];
      const rawLines = getMatchingCrashLines(logs, pending.occurredAt);

      if (state?.status === 'running' && trigger === 'bridge-disconnect') {
        crashLogger.debug(
          'runtime bridge disconnected without confirmed app death'
        );
        notifyFailure(
          new RuntimeDisconnectError(
            pending.testFilePath,
            buildRuntimeDisconnectDetails(pending.phase, rawLines)
          )
        );
        return;
      }

      alive = false;
      crashLogger.debug('native crash detected (phase=%s)', pending.phase);
      for (const line of rawLines) {
        crashLogger.debug('%s', line);
      }

      const fallbackSummary =
        trigger === 'bridge-disconnect'
          ? 'The app process exited after the runtime bridge disconnected, but no crash log lines were found.'
          : 'The app process exited, but no crash log lines were found.';
      const details = buildNativeCrashDetails(
        pending.phase,
        rawLines,
        fallbackSummary
      );
      const extractedDetails = session?.getCrashDetails
        ? await session
            .getCrashDetails({
              occurredAt: pending.occurredAt,
              pid: getStatePid(state),
              processName: details.processName,
              testFilePath: pending.testFilePath,
            })
            .catch((error) => {
              crashLogger.warn(
                'failed to extract native crash details: %s',
                error
              );
              return null;
            })
        : null;
      notifyFailure(
        new NativeCrashError(
          pending.testFilePath,
          mergeCrashDetails(details, extractedDetails)
        )
      );
    } finally {
      isResolvingCrash = false;
      pendingTimer = null;
    }
  };

  const startCrashResolution = (trigger: 'bridge-disconnect' | 'app-exit') => {
    if (disposed || !monitoring || isResolvingCrash) {
      return;
    }

    clearPendingTimer();
    const pending: PendingCrash = {
      testFilePath: currentTestFilePath,
      phase: currentPhase,
      occurredAt: Date.now(),
    };

    pendingTimer = setTimeout(
      () => {
        void classify(pending, trigger);
      },
      trigger === 'bridge-disconnect' ? CRASH_CLASSIFICATION_SETTLE_MS : 0
    );
  };

  const appSessionListener: AppSessionListener = (event: AppSessionEvent) => {
    if (event.type === 'app_exited') {
      startCrashResolution('app-exit');
    }
  };

  const setAppSession = (session: AppSession | null) => {
    appSession?.removeListener(appSessionListener);
    appSession = session;
    alive = Boolean(session);
    session?.addListener(appSessionListener);
  };

  setAppSession(initialAppSession);

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
      clearPendingTimer();
      await sleep(0);
    },
    start: async () => {
      monitoring = true;
    },
    reset: () => {
      alive = Boolean(appSession);
      watchers.clear();
      isResolvingCrash = false;
      currentTestFilePath = '';
      clearPendingTimer();
    },
    setAppSession,
    handleBridgeDisconnect: () => {
      startCrashResolution('bridge-disconnect');
    },
    dispose: async () => {
      disposed = true;
      monitoring = false;
      watchers.clear();
      isResolvingCrash = false;
      clearPendingTimer();
      appSession?.removeListener(appSessionListener);
      appSession = null;
      alive = false;
    },
  };
};
