export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20_000;

export type BridgeHeartbeat = {
  notifyPong: (id: number) => void;
  dispose: () => void;
};

export const createHeartbeat = (options: {
  sendPing: (id: number) => void;
  onTimeout: () => void;
  intervalMs?: number;
  timeoutMs?: number;
}): BridgeHeartbeat => {
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  let nextPingId = 1;
  let pendingPingId: number | null = null;
  let disposed = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const clearPendingTimeout = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  const intervalHandle = setInterval(() => {
    if (disposed || pendingPingId !== null) {
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

  return {
    notifyPong: (id) => {
      if (id !== pendingPingId) {
        return;
      }

      pendingPingId = null;
      clearPendingTimeout();
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      clearInterval(intervalHandle);
      clearPendingTimeout();
    },
  };
};
