import type { JsBlockBudget } from './js-watchdog.js';
import type { BridgeEvents } from './shared.js';

export type JsBlockBudgetPolicyOptions = {
  /** Budget outside any test or file load. */
  idleMs: number;
  /** Budget while a test file loads (module code and `describe` bodies). */
  fileLoadMs: number;
  /** Added to a test's own timeout. */
  graceMs: number;
};

export const IDLE_BUDGET_LABEL = 'between test phases';

export const getIdleBudget = (
  options: JsBlockBudgetPolicyOptions,
): JsBlockBudget => ({ ms: options.idleMs, label: IDLE_BUDGET_LABEL });

/**
 * Maps a runner event to the block budget that applies from then on, or
 * `null` for events that do not change it. Budgets come from timeouts the
 * user already configures, so long work within them never fails a run.
 */
export const getJsBlockBudgetForEvent = (
  event: BridgeEvents,
  options: JsBlockBudgetPolicyOptions,
): JsBlockBudget | null => {
  switch (event.type) {
    case 'collection-started':
      return { ms: options.fileLoadMs, label: `loading ${event.file}` };
    case 'test-started':
      if (event.timeout === undefined) {
        return null;
      }

      return {
        ms: event.timeout + options.graceMs,
        label: `test "${event.fullName}" (${event.timeout}ms timeout + ${options.graceMs}ms grace)`,
      };
    case 'collection-finished':
    case 'test-finished':
      return getIdleBudget(options);
    default:
      return null;
  }
};
