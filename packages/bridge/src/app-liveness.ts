import {
  createConnectionCheck,
  type ConnectionCheckOptions,
  type PingableSocket,
} from './connection-check.js';
import { AppBridgeDisconnectedError } from './errors.js';
import {
  getIdleBudget,
  getJsBlockBudgetForEvent,
  type JsBlockBudgetPolicyOptions,
} from './js-block-budget-policy.js';
import { createJsWatchdog } from './js-watchdog.js';
import type { BridgeEvents } from './shared.js';

export type AppLivenessOptions = {
  connectionCheck: ConnectionCheckOptions;
  jsBlockBudget: JsBlockBudgetPolicyOptions;
  jsProbeIntervalMs?: number;
};

export type AppLivenessOverrides = {
  connectionCheck?: Partial<ConnectionCheckOptions>;
  jsBlockBudget?: Partial<JsBlockBudgetPolicyOptions>;
  jsProbeIntervalMs?: number;
};

export const DEFAULT_APP_LIVENESS_OPTIONS: AppLivenessOptions = {
  connectionCheck: { intervalMs: 5_000, timeoutMs: 20_000 },
  jsBlockBudget: { idleMs: 20_000, fileLoadMs: 60_000, graceMs: 5_000 },
};

export const resolveAppLivenessOptions = (
  overrides: AppLivenessOverrides = {},
): AppLivenessOptions => ({
  connectionCheck: {
    ...DEFAULT_APP_LIVENESS_OPTIONS.connectionCheck,
    ...overrides.connectionCheck,
  },
  jsBlockBudget: {
    ...DEFAULT_APP_LIVENESS_OPTIONS.jsBlockBudget,
    ...overrides.jsBlockBudget,
  },
  jsProbeIntervalMs: overrides.jsProbeIntervalMs,
});

export type AppLiveness = {
  handleEvent: (event: BridgeEvents) => void;
  handleProbeAck: (id: number) => void;
  dispose: () => void;
};

/**
 * Watches one app connection with two independent checks: the connection
 * check (is the process reachable?) and the JS watchdog (is the JS thread
 * getting a turn?). See docs/adr/0001-app-liveness-detection.md.
 */
export const createAppLiveness = (options: {
  socket: PingableSocket;
  sendProbe: (id: number) => void;
  onLost: (error: AppBridgeDisconnectedError) => void;
  config: AppLivenessOptions;
}): AppLiveness => {
  const connectionCheck = createConnectionCheck(options.socket, {
    ...options.config.connectionCheck,
    onLost: () => {
      options.onLost(new AppBridgeDisconnectedError('connection-lost'));
    },
  });

  const watchdog = createJsWatchdog({
    sendProbe: options.sendProbe,
    initialBudget: getIdleBudget(options.config.jsBlockBudget),
    probeIntervalMs: options.config.jsProbeIntervalMs,
    onUnresponsive: (budget) => {
      options.onLost(
        new AppBridgeDisconnectedError('js-thread-unresponsive', budget.label),
      );
    },
  });

  return {
    handleEvent: (event) => {
      const budget = getJsBlockBudgetForEvent(
        event,
        options.config.jsBlockBudget,
      );

      if (budget) {
        watchdog.setBlockBudget(budget);
      }
    },
    handleProbeAck: watchdog.notifyProbeAck,
    dispose: () => {
      connectionCheck.dispose();
      watchdog.dispose();
    },
  };
};
