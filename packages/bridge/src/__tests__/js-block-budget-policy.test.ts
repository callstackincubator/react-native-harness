import { describe, expect, it } from 'vitest';
import {
  createJsBlockBudgetPolicy,
  IDLE_BUDGET_LABEL,
} from '../js-block-budget-policy.js';
import type { BridgeEvents } from '../shared.js';

const options = { idleMs: 20_000, fileLoadMs: 60_000, graceMs: 5_000 };
const idle = { ms: 20_000, label: IDLE_BUDGET_LABEL };
const file = 'button.harness.tsx';

const testEvent = {
  name: 'renders',
  suite: 'Button',
  file,
  ancestorTitles: ['Button'],
  fullName: 'Button renders',
  startedAt: 0,
};

const testStarted = (timeout?: number): BridgeEvents => ({
  type: 'test-started',
  ...testEvent,
  timeout,
});
const testFinished: BridgeEvents = {
  type: 'test-finished',
  ...testEvent,
  duration: 1,
  status: 'passed',
};
const suiteStarted = (name: string, timeout?: number): BridgeEvents => ({
  type: 'suite-started',
  name,
  file,
  timeout,
});
const suiteFinished = (name: string): BridgeEvents => ({
  type: 'suite-finished',
  name,
  file,
  duration: 1,
  status: 'passed',
});
const hooksOf = (name: string, timeout: number) => ({
  ms: timeout + 5_000,
  label: `beforeAll/afterAll hooks of suite "${name}" (${timeout}ms timeout + 5000ms grace)`,
});

/** Feeds events to a fresh policy and returns the budget after each. */
const budgetsFor = (events: BridgeEvents[]) => {
  const policy = createJsBlockBudgetPolicy(options);
  return events.map((event) => policy.getBudgetForEvent(event));
};

describe('JS block budget policy', () => {
  it('gives loading a setup file or a test file the file-load budget', () => {
    expect(
      budgetsFor([
        { type: 'setup-file-bundling-finished', file: 'setup.ts', setupType: 'setupFiles', duration: 1 },
        { type: 'collection-started', file },
        { type: 'collection-finished', file, duration: 1, totalTests: 1 },
      ]),
    ).toEqual([
      { ms: 60_000, label: 'loading setup file setup.ts' },
      { ms: 60_000, label: `loading ${file}` },
      idle,
    ]);
  });

  it('gives a test its timeout plus grace, and leaves skipped tests alone', () => {
    expect(budgetsFor([testStarted(30_000), testFinished, testStarted()])).toEqual([
      {
        ms: 35_000,
        label: 'test "Button renders" (30000ms timeout + 5000ms grace)',
      },
      idle,
      null,
    ]);
  });

  it("gives a suite's beforeAll/afterAll hooks their timeout between its tests", () => {
    expect(
      budgetsFor([
        suiteStarted('Button', 30_000), // beforeAll runs
        testStarted(30_000),
        testFinished, // afterAll may run next
        suiteFinished('Button'),
      ]),
    ).toEqual([
      hooksOf('Button', 30_000),
      expect.objectContaining({ ms: 35_000 }),
      hooksOf('Button', 30_000),
      idle,
    ]);
  });

  it('returns to the enclosing suite when a nested suite finishes', () => {
    expect(
      budgetsFor([
        suiteStarted('Outer', 30_000),
        suiteStarted('Inner', 30_000),
        suiteFinished('Inner'), // Outer's afterAll may run next
        suiteFinished('Outer'),
      ]),
    ).toEqual([
      hooksOf('Outer', 30_000),
      hooksOf('Inner', 30_000),
      hooksOf('Outer', 30_000),
      idle,
    ]);
  });

  it('keeps the enclosing budget for a skipped suite', () => {
    expect(
      budgetsFor([
        suiteStarted('Outer', 30_000),
        suiteStarted('Skipped'),
        suiteFinished('Skipped'),
      ]),
    ).toEqual([
      hooksOf('Outer', 30_000),
      hooksOf('Outer', 30_000),
      hooksOf('Outer', 30_000),
    ]);
  });

  it('forgets running suites when a new file starts', () => {
    const policy = createJsBlockBudgetPolicy(options);
    policy.getBudgetForEvent(suiteStarted('Abandoned', 30_000));

    expect(policy.getBudgetForEvent({ type: 'file-started', file })).toEqual(idle);
    expect(policy.getBudgetForEvent(testFinished)).toEqual(idle);
  });

  it('ignores events that do not change the budget', () => {
    expect(
      budgetsFor([{ type: 'module-bundling-started', file }]),
    ).toEqual([null]);
  });
});

describe('app liveness options', () => {
  it('keeps the default for an override that is undefined', async () => {
    const { resolveAppLivenessOptions, DEFAULT_APP_LIVENESS_OPTIONS } =
      await import('../app-liveness.js');

    expect(
      resolveAppLivenessOptions({
        jsBlockBudget: { fileLoadMs: undefined, idleMs: 1_000 },
      }).jsBlockBudget,
    ).toEqual({
      ...DEFAULT_APP_LIVENESS_OPTIONS.jsBlockBudget,
      idleMs: 1_000,
    });
  });
});
