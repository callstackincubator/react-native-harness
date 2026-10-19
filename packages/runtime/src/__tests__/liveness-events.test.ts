import {
  afterAll as harnessAfterAll,
  beforeAll as harnessBeforeAll,
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
 * Models the bridge, which hands an event to `WebSocket.send` one microtask
 * after it is emitted. The harness's JS watchdog only learns about a phase
 * from that message, so it must be sent before user code that may block the
 * thread starts.
 */
const trackSentEvents = <E extends { type: string }>(events: {
  addListener: (listener: (event: E) => void) => void;
}) => {
  const sent: E[] = [];

  events.addListener((event) => {
    queueMicrotask(() => sent.push(event));
  });

  return {
    sent,
    lastSent: () => sent[sent.length - 1],
  };
};

describe('liveness events', () => {
  it('sends each phase with its timeout before user code runs in it', async () => {
    const collector = getTestCollector();
    const runner = getTestRunner();
    const tracker = trackSentEvents<TestRunnerEvents>(runner.events);
    const seen: Record<string, TestRunnerEvents | undefined> = {};

    const collection = await collector.collect(() => {
      harnessDescribe('Suite', () => {
        harnessBeforeAll(() => {
          seen.beforeAll = tracker.lastSent();
        });
        harnessIt('runs', () => {
          seen.test = tracker.lastSent();
        });
        harnessIt.skip('is skipped', () => undefined);
        harnessAfterAll(() => {
          seen.afterAll = tracker.lastSent();
        });
      });
    }, 'runtime/liveness.test.ts');

    const result = await runner.run({
      testSuite: collection.testSuite,
      testFilePath: 'runtime/liveness.test.ts',
      runner: 'ios',
      testTimeout: 12_345,
    });

    expect(result.status).toBe('passed');
    expect(seen.beforeAll).toMatchObject({
      type: 'suite-started',
      name: 'Suite',
      timeout: 12_345,
    });
    expect(seen.test).toMatchObject({
      type: 'test-started',
      name: 'runs',
      timeout: 12_345,
    });
    expect(seen.afterAll).toMatchObject({
      type: 'test-finished',
      name: 'is skipped',
    });
    expect(
      tracker.sent.find(
        (event) => event.type === 'test-started' && event.name === 'is skipped',
      ),
    ).toMatchObject({ timeout: undefined });

    collector.dispose();
    runner.dispose();
  });

  it('sends a test file load before evaluating the file', async () => {
    const collector = getTestCollector();
    const tracker = trackSentEvents<TestCollectorEvents>(collector.events);
    let sentBeforeEvaluation: TestCollectorEvents | undefined;

    await collector.collect(() => {
      sentBeforeEvaluation = tracker.lastSent();
    }, 'runtime/liveness.test.ts');

    expect(sentBeforeEvaluation).toMatchObject({ type: 'collection-started' });

    collector.dispose();
  });
});
