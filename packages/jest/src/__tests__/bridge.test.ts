/**
 * Integration test pairing createHarnessBridge (CLI side) with
 * connectToHarness (app side). Tests the full connection lifecycle and
 * RPC round-trip without coupling tests to the transport internals.
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessBridge } from '@react-native-harness/bridge/server';
import { createHarnessBridge } from '@react-native-harness/bridge/server';
import { connectToHarness } from '@react-native-harness/bridge/client';
import type { HarnessContext } from '@react-native-harness/bridge';
import type { TestSuiteResult } from '@react-native-harness/bridge';

const makeContext = (
  updateSnapshot: HarnessContext['updateSnapshot'] = 'new',
): HarnessContext => ({
  platform: {
    name: 'ios',
    platformId: 'ios',
    runner: '/dev/null',
    config: {},
  },
  updateSnapshot,
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

  describe('screenshots', () => {
    it('transferScreenshot delivers the bytes to a file on the CLI side', async () => {
      const connectionPromise = bridge.nextConnection();
      const handle = await connect();
      handle.reportReady(device);
      await connectionPromise;

      const data = new Uint8Array(5 * 1024 * 1024);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = i % 251;
      }

      const file = await handle.transferScreenshot(data, {
        width: 100,
        height: 200,
      });
      const written = await fs.readFile(file.path);
      await fs.rm(file.path, { force: true });

      expect(written.equals(Buffer.from(data))).toBe(true);
      handle.disconnect();
    });
  });

  describe('image snapshots', () => {
    it.each([
      [
        'writes a missing snapshot and passes when the run passes updateSnapshot new',
        makeContext('new'),
        true,
      ],
      [
        'fails a missing snapshot without writing it in CI mode when the run passes updateSnapshot none',
        makeContext('none'),
        false,
      ],
      [
        'writes a missing snapshot and passes when the context names no snapshot state',
        { platform: makeContext().platform },
        true,
      ],
    ] as const)(
      '%s',
      async (_, context, written) => {
        bridge.dispose();
        bridge = await createHarnessBridge({ port: 0, context });
        bridgePort = (bridge.ws.address() as { port: number }).port;

        const directory = await fs.mkdtemp(
          path.join(os.tmpdir(), 'harness-bridge-snapshot-'),
        );

        try {
          const receivedPath = path.join(directory, 'received.png');
          await fs.writeFile(receivedPath, 'received image');

          const connectionPromise = bridge.nextConnection();
          const handle = await connect();
          handle.reportReady(device);
          await connectionPromise;

          const result = await handle.matchImageSnapshot(
            { path: receivedPath },
            path.join(directory, 'example.harness.tsx'),
            { name: 'square' },
            'ios',
          );

          expect(result.pass).toBe(written);
          expect(
            existsSync(
              path.join(directory, '__image_snapshots__', 'ios', 'square.png'),
            ),
          ).toBe(written);
          handle.disconnect();
        } finally {
          await fs.rm(directory, { force: true, recursive: true });
        }
      },
    );
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
