import {
  afterAll as harnessAfterAll,
  afterEach as harnessAfterEach,
  beforeAll as harnessBeforeAll,
  beforeEach as harnessBeforeEach,
  describe as harnessDescribe,
  getTestCollector,
  it as harnessIt,
} from '../collector/index.js';
import type {
  TestCollectorEvents,
  TestRunnerEvents,
} from '@react-native-harness/bridge';
import { getTestRunner } from '../runner/index.js';
import {
  beginTestHostSession,
  HostSurfaceReplacedError,
  observeTestHostSurface,
} from '../host-surface.js';
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


const createDeferred = () => {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => { resolver = resolve; });
  return {
    promise,
    resolve: () => {
      if (resolver === undefined) throw new Error('Deferred resolver is unavailable');
      resolver();
    },
  };
};

describe('test host interruption', () => {
  it.each(['beforeAll', 'beforeEach', 'test', 'afterEach', 'afterAll', 'onTestFailed', 'onTestFinished'])(
    'interrupts an in-flight %s and does not start later hooks or tests',
    async (phase) => {
      observeTestHostSurface(1);
      const session = beginTestHostSession('runtime/host.harness.tsx');
      const collector = getTestCollector();
      const runner = getTestRunner();
      const entered = createDeferred();
      const resume = createDeferred();
      const calls: string[] = [];
      const pause = async () => {
        calls.push(phase);
        entered.resolve();
        await resume.promise;
      };
      const record = (name: string) => () => {
        calls.push(name);
      };

      try {
        const collection = await collector.collect(() => {
          harnessDescribe('Interrupted host', () => {
            harnessBeforeAll(phase === 'beforeAll' ? pause : record('beforeAll'));
            harnessBeforeAll(record('second beforeAll'));
            harnessBeforeEach(phase === 'beforeEach' ? pause : record('beforeEach'));
            harnessBeforeEach(record('second beforeEach'));
            harnessAfterEach(phase === 'afterEach' ? pause : record('afterEach'));
            harnessAfterEach(record('second afterEach'));
            harnessAfterAll(phase === 'afterAll' ? pause : record('afterAll'));
            harnessAfterAll(record('second afterAll'));
            harnessIt('first', async (context) => {
              if (phase === 'onTestFailed' || phase === 'onTestFinished') {
                context[phase](record('later lifecycle callback'));
                context[phase](pause);
                if (phase === 'onTestFailed') throw new Error('Test failure');
              }
              await (phase === 'test' ? pause() : record('first test')());
            });
            harnessIt('later', record('later test'));
          });
        }, 'runtime/host.harness.tsx');

        const running = runner.run({
          testSuite: collection.testSuite,
          testFilePath: 'runtime/host.harness.tsx',
          runner: 'android',
          testTimeout: 60_000,
        });
        const rejection = expect(running).rejects.toBeInstanceOf(HostSurfaceReplacedError);
        await entered.promise;
        observeTestHostSurface(11);
        await rejection;
        const callsAtInterruption = [...calls];

        // Disposing the file must not let abandoned work resume later hooks.
        session.dispose();
        resume.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(calls).toEqual(callsAtInterruption);
      } finally {
        resume.resolve();
        session.dispose();
        collector.dispose();
        runner.dispose();
      }
    },
  );

  it('allows same-surface observations and surface changes between files', async () => {
    observeTestHostSurface(1);
    const first = beginTestHostSession('first.harness.tsx');
    try {
      observeTestHostSurface(1);
      await expect(first.run(async () => 'first')).resolves.toBe('first');
    } finally {
      first.dispose();
    }

    observeTestHostSurface(11);
    const next = beginTestHostSession('next.harness.tsx');
    try {
      observeTestHostSurface(11);
      await expect(next.run(async () => 'next')).resolves.toBe('next');
    } finally {
      next.dispose();
    }
  });
});
