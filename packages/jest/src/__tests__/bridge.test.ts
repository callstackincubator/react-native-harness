/**
 * Integration test pairing createHarnessBridge (CLI side) with
 * connectToHarness (app side). Tests the full connection lifecycle and
 * RPC round-trip without knowing birpc internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessBridge } from '@react-native-harness/bridge/server';
import { createHarnessBridge } from '@react-native-harness/bridge/server';
import { connectToHarness } from '@react-native-harness/bridge/client';
import type { HarnessContext } from '@react-native-harness/bridge';

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

const connect = (callbacks: Parameters<typeof connectToHarness>[1] = { runTests: vi.fn() }) =>
  connectToHarness(`ws://127.0.0.1:${bridgePort}`, callbacks);

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
      const handle = await connect({ runTests: runTestsCb });
      handle.reportReady(device);

      const conn = await connectionPromise;
      const result = await conn.runTests('example.ts', {
        runner: '/runner.js',
      });

      expect(runTestsCb).toHaveBeenCalledWith('example.ts', expect.objectContaining({ runner: '/runner.js' }));
      expect(result.tests[0].name).toBe('passes');
      handle.disconnect();
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

  describe('dispose', () => {
    it('rejects pending nextConnection() waiters', async () => {
      const pending = bridge.nextConnection();
      bridge.dispose();

      await expect(pending).rejects.toThrow('Bridge disposed');
    });
  });
});
