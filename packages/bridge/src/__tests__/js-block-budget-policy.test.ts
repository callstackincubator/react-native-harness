import { describe, expect, it } from 'vitest';
import {
  getJsBlockBudgetForEvent,
  IDLE_BUDGET_LABEL,
} from '../js-block-budget-policy.js';
import type { BridgeEvents } from '../shared.js';

const options = { idleMs: 20_000, fileLoadMs: 60_000, graceMs: 5_000 };

const testEvent = {
  name: 'renders',
  suite: 'Button',
  file: 'button.harness.tsx',
  ancestorTitles: ['Button'],
  fullName: 'Button renders',
  startedAt: 0,
};

describe('JS block budget policy', () => {
  it.each<[string, BridgeEvents, ReturnType<typeof getJsBlockBudgetForEvent>]>([
    [
      'loading a test file',
      { type: 'collection-started', file: 'button.harness.tsx' },
      { ms: 60_000, label: 'loading button.harness.tsx' },
    ],
    [
      'running a test',
      { type: 'test-started', ...testEvent, timeout: 30_000 },
      {
        ms: 35_000,
        label: 'test "Button renders" (30000ms timeout + 5000ms grace)',
      },
    ],
    [
      'a skipped test, which has no timeout',
      { type: 'test-started', ...testEvent },
      null,
    ],
    [
      'a finished test',
      {
        type: 'test-finished',
        ...testEvent,
        duration: 1,
        status: 'passed',
      },
      { ms: 20_000, label: IDLE_BUDGET_LABEL },
    ],
    [
      'a loaded test file',
      {
        type: 'collection-finished',
        file: 'button.harness.tsx',
        duration: 1,
        totalTests: 1,
      },
      { ms: 20_000, label: IDLE_BUDGET_LABEL },
    ],
    [
      'an event that does not change the budget',
      { type: 'suite-started', name: 'Button', file: 'button.harness.tsx' },
      null,
    ],
  ])('%s', (_name, event, expected) => {
    expect(getJsBlockBudgetForEvent(event, options)).toEqual(expected);
  });
});
