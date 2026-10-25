/**
 * The longest the app's JS thread may go without answering a `js-probe`, and
 * a label naming what it is busy with, used in the failure message.
 */
export type JsBlockBudget = {
  ms: number;
  label: string;
};

export type JsWatchdog = {
  notifyProbeAck: (id: number) => void;
  /**
   * Replaces the current budget. The new budget covers silence from the
   * later of the last acknowledged probe and the change itself: a block that
   * fitted the previous budget is never judged against a smaller one.
   */
  setBlockBudget: (budget: JsBlockBudget) => void;
  dispose: () => void;
};

export const DEFAULT_JS_PROBE_INTERVAL_MS = 1_000;

/**
 * Checks that the app's JS thread keeps getting a turn to run. The server
 * sends `js-probe` messages, which only JS can answer, and fails once the
 * thread has been silent for longer than the current block budget.
 */
export const createJsWatchdog = (options: {
  sendProbe: (id: number) => void;
  onUnresponsive: (budget: JsBlockBudget) => void;
  initialBudget: JsBlockBudget;
  probeIntervalMs?: number;
}): JsWatchdog => {
  let budget = options.initialBudget;
  let lastAckAt = Date.now();
  let budgetSetAt = lastAckAt;
  let nextProbeId = 1;
  let pendingProbeId: number | null = null;
  let disposed = false;

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    clearInterval(interval);
  };

  const interval = setInterval(() => {
    if (Date.now() - Math.max(lastAckAt, budgetSetAt) > budget.ms) {
      dispose();
      options.onUnresponsive(budget);
      return;
    }

    if (pendingProbeId === null) {
      pendingProbeId = nextProbeId++;
      options.sendProbe(pendingProbeId);
    }
  }, options.probeIntervalMs ?? DEFAULT_JS_PROBE_INTERVAL_MS);

  return {
    notifyProbeAck: (id) => {
      if (id !== pendingProbeId) {
        return;
      }

      pendingProbeId = null;
      lastAckAt = Date.now();
    },
    setBlockBudget: (next) => {
      budget = next;
      budgetSetAt = Date.now();
    },
    dispose,
  };
};
