/**
 * Checks that the app process is still reachable, using WebSocket protocol
 * ping frames (RFC 6455). The app's native WebSocket answers them without
 * involving JS (OkHttp on Android, SocketRocket on iOS, the network stack in
 * browsers), so a blocked JS thread does not fail this check.
 */
export type PingableSocket = {
  ping: () => void;
  on: (event: 'pong', listener: () => void) => unknown;
  off: (event: 'pong', listener: () => void) => unknown;
};

export type ConnectionCheckOptions = {
  intervalMs: number;
  timeoutMs: number;
};

export type ConnectionCheck = {
  dispose: () => void;
};

export const createConnectionCheck = (
  socket: PingableSocket,
  options: ConnectionCheckOptions & { onLost: () => void },
): ConnectionCheck => {
  let lastPongAt = Date.now();
  let disposed = false;

  const handlePong = () => {
    lastPongAt = Date.now();
  };

  socket.on('pong', handlePong);

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    clearInterval(interval);
    socket.off('pong', handlePong);
  };

  const interval = setInterval(() => {
    if (Date.now() - lastPongAt > options.timeoutMs) {
      dispose();
      options.onLost();
      return;
    }

    try {
      socket.ping();
    } catch {
      // The socket is closing; its close event ends the session.
    }
  }, options.intervalMs);

  return { dispose };
};
