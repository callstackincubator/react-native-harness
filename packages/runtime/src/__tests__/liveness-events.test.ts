import {
  describe as harnessDescribe,
  getTestCollector,
  it as harnessIt,
} from '../collector/index.js';
import type {
  TestCollectorEvents,
  TestRunnerEvents,
} from '@react-native-harness/bridge';
import { getTestRunner } from '../runner/index.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../symbolicate.js', async () => {
  return {
    getCodeFrame: vi.fn(async () => null),
  };
});

/**
 * Records, for each event, whether a macrotask has run since it was emitted
 * by the time user code starts. The harness's JS watchdog only sees an event
 * once the JS thread gives up the current task, so user code that blocks
 * must not start in the same task as the event announcing it.
 */
const trackMacrotasksAfter = <E extends { type: string }>(
  events: { addListener: (listener: (event: E) => void) => void },
  type: E['type'],
) => {
  const state = { emitted: [] as E[], macrotaskRan: false };

  events.addListener((event) => {
    if (event.type !== type) {
      return;
    }

    state.emitted.push(event);
    state.macrotaskRan = false;
    setTimeout(() => {
      state.macrotaskRan = true;
    }, 0);
  });

  return state;
};

describe('liveness events', () => {
  it('reports each running test with its timeout before running it', async () => {
    const collector = getTestCollector();
    const runner = getTestRunner();
    const started = trackMacrotasksAfter<TestRunnerEvents>(
      runner.events,
      'test-started',
    );
    const ranAfterMacrotask: boolean[] = [];

    const collection = await collector.collect(() => {
      harnessDescribe('Suite', () => {
        harnessIt('runs', () => {
          ranAfterMacrotask.push(started.macrotaskRan);
        });
        harnessIt.skip('is skipped', () => undefined);
      });
    }, 'runtime/liveness.test.ts');

    const result = await runner.run({
      testSuite: collection.testSuite,
      testFilePath: 'runtime/liveness.test.ts',
      runner: 'ios',
      testTimeout: 12_345,
    });

    expect(result.status).toBe('passed');
    expect(started.emitted).toEqual([
      expect.objectContaining({ name: 'runs', timeout: 12_345 }),
      expect.objectContaining({ name: 'is skipped', timeout: undefined }),
    ]);
    expect(ranAfterMacrotask).toEqual([true]);

    collector.dispose();
    runner.dispose();
  });

  it('reports a test file load before evaluating the file', async () => {
    const collector = getTestCollector();
    const started = trackMacrotasksAfter<TestCollectorEvents>(
      collector.events,
      'collection-started',
    );
    let ranAfterMacrotask: boolean | null = null;

    await collector.collect(() => {
      ranAfterMacrotask = started.macrotaskRan;
    }, 'runtime/liveness.test.ts');

    expect(started.emitted).toHaveLength(1);
    expect(ranAfterMacrotask).toBe(true);

    collector.dispose();
  });
});
