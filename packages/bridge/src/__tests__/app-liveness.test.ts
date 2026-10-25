/**
 * Pairs createHarnessBridge with connectToHarness over a real WebSocket and
 * checks both liveness checks end to end.
 *
 * Server and app share one event loop here, so a real block would freeze
 * both. A blocked JS thread is simulated by holding back the app's
 * `js-probe-ack` messages at its socket until it is unblocked, which is when
 * a really blocked thread would send them. WebSocket protocol pings are
 * still answered by the socket implementation, as React Native's native
 * WebSocket does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket as WsWebSocket } from 'ws';
import { connectToHarness, type HarnessHandle } from '../client.js';
import type { StandardWebSocket } from '../link/index.js';
import {
  createHarnessBridge,
  type AppConnection,
  type HarnessBridge,
} from '../server.js';
import type { TestSuiteResult } from '../shared.js';

const device = {
  platform: 'ios' as const,
  manufacturer: 'Apple',
  model: 'iPhone 17 Pro Simulator',
  osVersion: '18.0',
};

const testEvent = {
  name: 'renders',
  suite: 'Button',
  file: 'button.harness.tsx',
  ancestorTitles: ['Button'],
  fullName: 'Button renders',
  startedAt: 0,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let bridge: HarnessBridge | null = null;
let handle: HarnessHandle | null = null;

afterEach(async () => {
  handle?.disconnect();
  bridge?.dispose();
  handle = null;
  bridge = null;
  await sleep(10);
});

const setup = async (options: { autoPong?: boolean } = {}) => {
  bridge = await createHarnessBridge({
    port: 0,
    context: {
      platform: { name: 'ios', platformId: 'ios', runner: '/dev/null', config: {} },
    },
    liveness: {
      connectionCheck: { intervalMs: 20, timeoutMs: 150 },
      jsBlockBudget: { idleMs: 150, fileLoadMs: 300, graceMs: 50 },
      jsProbeIntervalMs: 10,
    },
  });
  const port = (bridge.ws.address() as { port: number }).port;

  let blocked = false;
  const heldBack: Array<() => void> = [];
  const js = {
    block: () => {
      blocked = true;
    },
    unblock: () => {
      blocked = false;
      for (const send of heldBack.splice(0)) send();
    },
  };
  const connection = bridge.nextConnection();

  handle = await connectToHarness(
    `ws://127.0.0.1:${port}`,
    {
      // A test file run that never finishes, so the session stays open
      // until a liveness check ends it.
      runTests: () => new Promise<TestSuiteResult>(() => undefined),
      resetEnvironment: async () => undefined,
    },
    {
      createSocket: (url) => {
        const socket = new WsWebSocket(url, {
          autoPong: options.autoPong ?? true,
        });
        const send = socket.send.bind(socket);
        socket.send = ((data: string | Uint8Array) => {
          if (blocked && typeof data === 'string' && data.includes('js-probe-ack')) {
            heldBack.push(() => send(data));
            return;
          }
          send(data);
        }) as typeof socket.send;
        return socket as unknown as StandardWebSocket;
      },
    },
  );
  handle.reportReady(device);

  const conn: AppConnection = await connection;
  const run = conn.runTests('button.harness.tsx', { runner: '/runner.js' });
  // Observed lazily, so a run that never fails does not leak a rejection.
  const outcome = run.then(
    () => ({ failed: false as const }),
    (error: Error & { reason?: string }) => ({ failed: true as const, error }),
  );

  const failedWithin = async (ms: number) =>
    await Promise.race([outcome, sleep(ms).then(() => ({ failed: false as const }))]);

  return { js, handle, failedWithin };
};

describe('app liveness', () => {
  it('keeps a responsive app connected', async () => {
    const { failedWithin } = await setup();

    expect((await failedWithin(500)).failed).toBe(false);
  });

  it('fails a blocked JS thread after the idle budget, naming the phase', async () => {
    const { js, failedWithin } = await setup();

    js.block();
    const outcome = await failedWithin(1_000);

    expect(outcome.failed).toBe(true);
    if (outcome.failed) {
      expect(outcome.error.reason).toBe('js-thread-unresponsive');
      expect(outcome.error.message).toContain('between test phases');
    }
  });

  it('lets a test block the JS thread for as long as its timeout allows', async () => {
    const { js, handle, failedWithin } = await setup();

    handle.emitEvent({ type: 'test-started', ...testEvent, timeout: 400 });
    await sleep(20);

    // Blocked for twice the idle budget, but within the test's timeout.
    js.block();
    expect((await failedWithin(300)).failed).toBe(false);
    js.unblock();
    expect((await failedWithin(100)).failed).toBe(false);

    handle.emitEvent({
      type: 'test-finished',
      ...testEvent,
      duration: 400,
      status: 'passed',
    });
    expect((await failedWithin(200)).failed).toBe(false);
  });

  it('fails a test that blocks the JS thread past its timeout, naming the test', async () => {
    const { js, handle, failedWithin } = await setup();

    handle.emitEvent({ type: 'test-started', ...testEvent, timeout: 200 });
    await sleep(20);

    js.block();
    const startedAt = Date.now();
    const outcome = await failedWithin(1_000);

    expect(outcome.failed).toBe(true);
    // Not before the test's timeout plus grace (200 + 50ms).
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
    if (outcome.failed) {
      expect(outcome.error.reason).toBe('js-thread-unresponsive');
      expect(outcome.error.message).toContain(
        'test "Button renders" (200ms timeout + 50ms grace)',
      );
    }
  });

  it('gives loading a test file the file-load budget', async () => {
    const { js, handle, failedWithin } = await setup();

    handle.emitEvent({ type: 'collection-started', file: 'button.harness.tsx' });
    await sleep(20);

    js.block();
    // Past the idle budget (150ms), within the file-load budget (300ms).
    expect((await failedWithin(220)).failed).toBe(false);

    const outcome = await failedWithin(1_000);
    expect(outcome.failed).toBe(true);
    if (outcome.failed) {
      expect(outcome.error.message).toContain('loading button.harness.tsx');
    }
  });

  it("lets a suite's beforeAll/afterAll hooks block for as long as their timeout allows", async () => {
    const { js, handle, failedWithin } = await setup();

    handle.emitEvent({
      type: 'suite-started',
      name: 'Button',
      file: 'button.harness.tsx',
      timeout: 400,
    });
    await sleep(20);

    // A beforeAll blocking for twice the idle budget.
    js.block();
    expect((await failedWithin(300)).failed).toBe(false);
    js.unblock();

    // A test, then an afterAll blocking just as long.
    handle.emitEvent({ type: 'test-started', ...testEvent, timeout: 400 });
    handle.emitEvent({
      type: 'test-finished',
      ...testEvent,
      duration: 1,
      status: 'passed',
    });
    await sleep(20);
    js.block();
    expect((await failedWithin(300)).failed).toBe(false);

    const outcome = await failedWithin(1_000);
    expect(outcome.failed).toBe(true);
    if (outcome.failed) {
      expect(outcome.error.message).toContain(
        'beforeAll/afterAll hooks of suite "Button"',
      );
    }
  });

  it('gives loading a setup file the file-load budget', async () => {
    const { js, handle, failedWithin } = await setup();

    handle.emitEvent({
      type: 'setup-file-bundling-finished',
      file: 'setup.ts',
      setupType: 'setupFiles',
      duration: 1,
    });
    await sleep(20);

    js.block();
    expect((await failedWithin(220)).failed).toBe(false);

    const outcome = await failedWithin(1_000);
    expect(outcome.failed).toBe(true);
    if (outcome.failed) {
      expect(outcome.error.message).toContain('loading setup file setup.ts');
    }
  });

  it('does not fail right after a long test when the smaller idle budget applies', async () => {
    const { js, handle, failedWithin } = await setup();

    handle.emitEvent({ type: 'test-started', ...testEvent, timeout: 400 });
    await sleep(20);

    // Blocked for longer than the idle budget, within the test's budget...
    js.block();
    expect((await failedWithin(300)).failed).toBe(false);
    // ...then the test finishes before the held-back probe acks are sent.
    handle.emitEvent({
      type: 'test-finished',
      ...testEvent,
      duration: 300,
      status: 'passed',
    });
    await sleep(50);
    js.unblock();

    expect((await failedWithin(200)).failed).toBe(false);
  });

  it('reports a lost connection when the socket stops answering pings', async () => {
    const { failedWithin } = await setup({ autoPong: false });

    const outcome = await failedWithin(1_000);

    expect(outcome.failed).toBe(true);
    if (outcome.failed) {
      expect(outcome.error.reason).toBe('connection-lost');
    }
  });
});
