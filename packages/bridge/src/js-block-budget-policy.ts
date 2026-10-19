import type { JsBlockBudget } from './js-watchdog.js';
import type { BridgeEvents } from './shared.js';

export type JsBlockBudgetPolicyOptions = {
  /** Budget outside any test, hook or file load. */
  idleMs: number;
  /** Budget while a setup file or test file loads (module code and `describe` bodies). */
  fileLoadMs: number;
  /** Added to a test's or hook's own timeout. */
  graceMs: number;
};

export const IDLE_BUDGET_LABEL = 'between test phases';

export const getIdleBudget = (
  options: JsBlockBudgetPolicyOptions,
): JsBlockBudget => ({ ms: options.idleMs, label: IDLE_BUDGET_LABEL });

export type JsBlockBudgetPolicy = {
  /**
   * Returns the block budget that applies from this event on, or `null` for
   * events that do not change it.
   */
  getBudgetForEvent: (event: BridgeEvents) => JsBlockBudget | null;
};

/**
 * Maps runner events to block budgets. Budgets come from timeouts the user
 * already configures, so long work within them never fails a run:
 *
 * - loading a setup file or test file: `fileLoadMs`
 * - a test, including its `beforeEach`/`afterEach` hooks: its timeout + grace
 * - a suite's `beforeAll`/`afterAll` hooks: the hook timeout + grace, from
 *   `suite-started` until `suite-finished`, outside the suite's tests
 * - anything else: `idleMs`
 */
export const createJsBlockBudgetPolicy = (
  options: JsBlockBudgetPolicyOptions,
): JsBlockBudgetPolicy => {
  const idle = getIdleBudget(options);
  // Hook budgets of the suites currently running, innermost last.
  const suites: JsBlockBudget[] = [];
  const outsideTests = () => suites[suites.length - 1] ?? idle;

  return {
    getBudgetForEvent: (event) => {
      switch (event.type) {
        case 'setup-file-bundling-finished':
          return {
            ms: options.fileLoadMs,
            label: `loading setup file ${event.file}`,
          };
        case 'collection-started':
          return { ms: options.fileLoadMs, label: `loading ${event.file}` };
        case 'setup-file-bundling-failed':
        case 'collection-finished':
        case 'file-started':
        case 'file-finished':
          suites.length = 0;
          return idle;
        case 'suite-started':
          suites.push(
            event.timeout === undefined
              ? outsideTests()
              : {
                  ms: event.timeout + options.graceMs,
                  label: `beforeAll/afterAll hooks of suite "${event.name}" (${event.timeout}ms timeout + ${options.graceMs}ms grace)`,
                },
          );
          return outsideTests();
        case 'suite-finished':
          suites.pop();
          return outsideTests();
        case 'test-started':
          if (event.timeout === undefined) {
            return null;
          }

          return {
            ms: event.timeout + options.graceMs,
            label: `test "${event.fullName}" (${event.timeout}ms timeout + ${options.graceMs}ms grace)`,
          };
        case 'test-finished':
          return outsideTests();
        default:
          return null;
      }
    },
  };
};
