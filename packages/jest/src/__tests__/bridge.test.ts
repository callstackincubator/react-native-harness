/**
 * Integration test pairing createHarnessBridge (CLI side) with
 * connectToHarness (app side). Tests the full connection lifecycle and
 * RPC round-trip without coupling tests to the transport internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessBridge } from '@react-native-harness/bridge/server';
import { createHarnessBridge } from '@react-native-harness/bridge/server';
import {
  connectToHarness,
  createWebSocketClientTransport,
} from '@react-native-harness/bridge/client';
import type {
  BridgeTransport,
  HarnessContext,
} from '@react-native-harness/bridge';
import type { TestSuiteResult } from '@react-native-harness/bridge';

const makeContext = (): HarnessContext => ({
  platform: {
    name: 'ios',
    platformId: 'ios',
    runner: '/dev/null',
    config: {},
  },
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let bridge: HarnessBridge;
let bridgePort: number;

beforeEach(async () => {
  bridge = await createHarnessBridge({ port: 0, context: makeContext() });
  bridgePort = (bridge.ws.address() as { port: number }).port;
});

afterEach(async () => {
  bridge.dispose();
  // Allow the server to close cleanly.
  await new Promise((r) => setTimeout(r, 10));
});

const connect = (
  callbacks: Parameters<typeof connectToHarness>[1] = {
    runTests: vi.fn(),
    resetEnvironment: vi.fn(),
  },
) => connectToHarness(`ws://127.0.0.1:${bridgePort}`, callbacks);

const device = {
  platform: 'ios' as const,
  manufacturer: 'Apple',
  model: 'iPhone 17 Pro Simulator',
  osVersion: '18.0',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bridge: createHarnessBridge + connectToHarness', () => {
  describe('connection lifecycle', () => {
    it('nextConnection() resolves once the app reports ready', async () => {
      const connectionPromise = bridge.nextConnection();

      const handle = await connect();
      handle.reportReady(device);

      const conn = await connectionPromise;
      expect(conn.device).toEqual(device);
      handle.disconnect();
    });

    it('bridge.connection is set after reportReady and cleared on disconnect', async () => {
      const connectionPromise = bridge.nextConnection();
      const handle = await connect();
      handle.reportReady(device);

      await connectionPromise;
      expect(bridge.connection).not.toBeNull();

      handle.disconnect();
      // Allow close event to propagate.
      await new Promise((r) => setTimeout(r, 20));
      expect(bridge.connection).toBeNull();
    });

    it('nextConnection() returns immediately if app already connected', async () => {
      // App connects before nextConnection() is called.
      const handle = await connect();
      handle.reportReady(device);

      // Yield so the server processes the reportReady before we ask.
      await new Promise((r) => setTimeout(r, 10));

      const conn = await bridge.nextConnection();
      expect(conn.device.platform).toBe('ios');
      handle.disconnect();
    });

    it('emits connected / disconnected events', async () => {
      const onConnected = vi.fn();
      const onDisconnected = vi.fn();
      bridge.on('connected', onConnected);
      bridge.on('disconnected', onDisconnected);

      const handle = await connect();
      handle.reportReady(device);
      await new Promise((r) => setTimeout(r, 10));

      expect(onConnected).toHaveBeenCalledOnce();

      handle.disconnect();
      await new Promise((r) => setTimeout(r, 20));

      expect(onDisconnected).toHaveBeenCalledOnce();
    });

    it('nextConnection() rejects when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(bridge.nextConnection(controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
    });

    it('nextConnection() rejects when signal is aborted while waiting', async () => {
      const controller = new AbortController();
      const promise = bridge.nextConnection(controller.signal);

      controller.abort();

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('runTests round-trip', () => {
    it('CLI conn.runTests() invokes the app-side runTests callback', async () => {
      const suiteResult = {
        name: 'suite',
        tests: [{ name: 'passes', status: 'passed' as const, duration: 10 }],
        suites: [],
        status: 'passed' as const,
        duration: 30,
      };
      const runTestsCb = vi.fn(async () => suiteResult);

      const connectionPromise = bridge.nextConnection();
      const handle = await connect({ runTests: runTestsCb, resetEnvironment: vi.fn() });
      handle.reportReady(device);

      const conn = await connectionPromise;
      const result = await conn.runTests('example.ts', {
        runner: '/runner.js',
      });

      expect(runTestsCb).toHaveBeenCalledWith('example.ts', expect.objectContaining({ runner: '/runner.js' }));
      expect(result.tests[0].name).toBe('passes');
      handle.disconnect();
    });

    it('rejects pending app calls when a newer client replaces the session', async () => {
      const firstHandle = await connect({
        runTests: async (): Promise<TestSuiteResult> =>
          await new Promise<TestSuiteResult>(() => undefined),
        resetEnvironment: vi.fn(),
      });
      firstHandle.reportReady(device);

      const firstConnection = await bridge.nextConnection();
      const pendingRun = firstConnection.runTests('example.ts', {
        runner: '/runner.js',
      });
      const pendingRunAssertion = expect(pendingRun).rejects.toThrow(
        'The app bridge was replaced by a newer app connection.',
      );

      const secondHandle = await connect();
      secondHandle.reportReady({
        ...device,
        model: 'iPhone 17 Pro Replacement',
      });

      await pendingRunAssertion;

      await new Promise((r) => setTimeout(r, 20));

      expect(bridge.connection?.device.model).toBe(
        'iPhone 17 Pro Replacement',
      );
      secondHandle.disconnect();
      firstHandle.disconnect();
    });
  });

  describe('bridge events', () => {
    it('emitEvent on app side fires the event listener on bridge', async () => {
      const onEvent = vi.fn();
      bridge.on('event', onEvent);

      const connectionPromise = bridge.nextConnection();
      const handle = await connect();
      handle.reportReady(device);
      await connectionPromise;

      handle.emitEvent({ type: 'collection-started', file: 'example.ts' });
      await new Promise((r) => setTimeout(r, 10));

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'collection-started', file: 'example.ts' }),
      );
      handle.disconnect();
    });
  });

  describe('heartbeat and blocking phases', () => {
    /**
     * Simulates an app whose JS thread is blocked: the socket stays open, but
     * no `pong` is produced. A real app blocks inside the synchronous `eval()`
     * of a freshly bundled test module, which can easily outlast the heartbeat
     * timeout on a large module graph. We cannot block the event loop here --
     * server and client share it in this test -- so we drop the pongs instead.
     */
    const connectBlockable = async (
      port: number,
      callbacks: Parameters<typeof connectToHarness>[1],
    ) => {
      const inner = createWebSocketClientTransport(`ws://127.0.0.1:${port}`);
      let jsThreadBlocked = false;

      const transport: BridgeTransport = {
        get state() {
          return inner.state;
        },
        send: (message) => {
          if (
            jsThreadBlocked &&
            typeof message === 'string' &&
            (JSON.parse(message) as { type: string }).type === 'pong'
          ) {
            return;
          }

          inner.send(message);
        },
        close: (code, reason) => inner.close(code, reason),
        onOpen: (listener) => inner.onOpen(listener),
        onMessage: (listener) => inner.onMessage(listener),
        onClose: (listener) => inner.onClose(listener),
        onError: (listener) => inner.onError(listener),
      };

      const handle = await connectToHarness(
        `ws://127.0.0.1:${port}`,
        callbacks,
        { transport },
      );

      return {
        handle,
        blockJsThread: () => {
          jsThreadBlocked = true;
        },
        unblockJsThread: () => {
          jsThreadBlocked = false;
        },
      };
    };

    const createHeartbeatBridge = () =>
      createHarnessBridge({
        port: 0,
        heartbeat: { intervalMs: 20, timeoutMs: 60, maxSuspendMs: 5_000 },
        context: makeContext(),
      });

    const suiteResult: TestSuiteResult = {
      name: 'suite',
      tests: [{ name: 'passes', status: 'passed', duration: 1 }],
      suites: [],
      status: 'passed',
      duration: 1,
    };

    it('fails the run when the app goes silent without announcing a blocking phase', async () => {
      const hbBridge = await createHeartbeatBridge();
      const port = (hbBridge.ws.address() as { port: number }).port;

      try {
        const app = await connectBlockable(port, {
          runTests: async () => {
            app.blockJsThread();
            await new Promise((r) => setTimeout(r, 300));
            return suiteResult;
          },
          resetEnvironment: vi.fn(),
        });
        app.handle.reportReady(device);

        const conn = await hbBridge.nextConnection();

        await expect(
          conn.runTests('example.ts', { runner: '/runner.js' }),
        ).rejects.toThrow('The app stopped answering harness heartbeats');
      } finally {
        hbBridge.dispose();
      }
    });

    it('completes the run when the app announces the blocking phase first', async () => {
      const hbBridge = await createHeartbeatBridge();
      const port = (hbBridge.ws.address() as { port: number }).port;

      try {
        const app = await connectBlockable(port, {
          runTests: async () => {
            // Sent *before* the thread blocks, exactly as the runtime does
            // around `eval()` of a bundled module.
            app.handle.setBusy(true, 'evaluating example.harness.tsx');
            app.blockJsThread();
            // Several heartbeat timeouts' worth of silence.
            await new Promise((r) => setTimeout(r, 300));
            app.unblockJsThread();
            app.handle.setBusy(false);
            return suiteResult;
          },
          resetEnvironment: vi.fn(),
        });
        app.handle.reportReady(device);

        const conn = await hbBridge.nextConnection();
        const result = await conn.runTests('example.ts', {
          runner: '/runner.js',
        });

        expect(result.tests[0].name).toBe('passes');
        app.handle.disconnect();
      } finally {
        hbBridge.dispose();
      }
    });

    it('names the blocking phase when the app stays blocked past the suspension limit', async () => {
      const hbBridge = await createHarnessBridge({
        port: 0,
        heartbeat: { intervalMs: 20, timeoutMs: 60, maxSuspendMs: 100 },
        context: makeContext(),
      });
      const port = (hbBridge.ws.address() as { port: number }).port;

      try {
        const app = await connectBlockable(port, {
          runTests: async () => {
            app.handle.setBusy(true, 'evaluating example.harness.tsx');
            app.blockJsThread();
            await new Promise((r) => setTimeout(r, 1_000));
            return suiteResult;
          },
          resetEnvironment: vi.fn(),
        });
        app.handle.reportReady(device);

        const conn = await hbBridge.nextConnection();

        await expect(
          conn.runTests('example.ts', { runner: '/runner.js' }),
        ).rejects.toThrow(
          'The app last reported it was busy with: evaluating example.harness.tsx.',
        );
      } finally {
        hbBridge.dispose();
      }
    });
  });

  describe('dispose', () => {
    it('rejects pending nextConnection() waiters', async () => {
      const pending = bridge.nextConnection();
      bridge.dispose();

      await expect(pending).rejects.toThrow(
        'The app bridge was disposed before the test file finished running.',
      );
    });
  });
});
