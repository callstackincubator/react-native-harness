export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20_000;
/**
 * Upper bound on how long a single `suspend()` may silence the heartbeat.
 * Suspension is driven by the app (see `BridgeBusyMessage`), so a crash or a
 * lost `busy: false` message must not disable liveness detection forever.
 */
export const DEFAULT_HEARTBEAT_MAX_SUSPEND_MS = 300_000;

export type BridgeHeartbeat = {
  notifyPong: (id: number) => void;
  /**
   * Stop pinging and drop any in-flight ping. Used while the app reports that
   * it is blocking its JS thread and therefore cannot answer. Automatically
   * lifted after `maxSuspendMs`.
   */
  suspend: () => void;
  resume: () => void;
  readonly suspended: boolean;
  dispose: () => void;
};

export const createHeartbeat = (options: {
  sendPing: (id: number) => void;
  onTimeout: () => void;
  intervalMs?: number;
  timeoutMs?: number;
  maxSuspendMs?: number;
  onSuspendExpired?: () => void;
}): BridgeHeartbeat => {
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const maxSuspendMs = options.maxSuspendMs ?? DEFAULT_HEARTBEAT_MAX_SUSPEND_MS;
  let nextPingId = 1;
  let pendingPingId: number | null = null;
  let disposed = false;
  let suspended = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let suspendHandle: ReturnType<typeof setTimeout> | null = null;

  const clearPendingTimeout = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  const clearSuspendTimeout = () => {
    if (suspendHandle) {
      clearTimeout(suspendHandle);
      suspendHandle = null;
    }
  };

  const intervalHandle = setInterval(() => {
    if (disposed || suspended || pendingPingId !== null) {
      return;
    }

    const pingId = nextPingId++;
    pendingPingId = pingId;
    options.sendPing(pingId);
    timeoutHandle = setTimeout(() => {
      if (disposed || pendingPingId !== pingId) {
        return;
      }

      pendingPingId = null;
      timeoutHandle = null;
      options.onTimeout();
    }, timeoutMs);
  }, intervalMs);

  const resume = () => {
    if (disposed || !suspended) {
      return;
    }

    clearSuspendTimeout();
    suspended = false;
    // Any ping sent before the suspension is unanswerable by now; start clean
    // so the app gets a full `timeoutMs` to reply to the next one.
    pendingPingId = null;
  };

  return {
    notifyPong: (id) => {
      if (id !== pendingPingId) {
        return;
      }

      pendingPingId = null;
      clearPendingTimeout();
    },
    suspend: () => {
      if (disposed || suspended) {
        return;
      }

      suspended = true;
      pendingPingId = null;
      clearPendingTimeout();
      suspendHandle = setTimeout(() => {
        suspendHandle = null;
        if (disposed || !suspended) {
          return;
        }

        options.onSuspendExpired?.();
        resume();
      }, maxSuspendMs);
    },
    resume,
    get suspended() {
      return suspended;
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      clearInterval(intervalHandle);
      clearPendingTimeout();
      clearSuspendTimeout();
    },
  };
};
