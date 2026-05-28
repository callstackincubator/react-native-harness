import { describe, expect, it, vi } from 'vitest';
import type { AppConnection } from '@react-native-harness/bridge/server';
import { waitForBridgeDisconnectOrTimeout } from '../harness-session.js';

const createConnection = (): AppConnection => ({
  device: {
    platform: 'ios',
    manufacturer: 'Apple',
    model: 'iPhone',
    osVersion: '18.0',
  },
  runTests: vi.fn(),
});

const createBridge = (connection: AppConnection | null) => {
  let currentConnection = connection;
  let disconnectedListener: (() => void) | null = null;

  return {
    get connection() {
      return currentConnection;
    },
    on: vi.fn((event: 'disconnected', listener: () => void) => {
      if (event === 'disconnected') {
        disconnectedListener = listener;
      }
    }),
    off: vi.fn((event: 'disconnected', listener: () => void) => {
      if (event === 'disconnected' && disconnectedListener === listener) {
        disconnectedListener = null;
      }
    }),
    disconnect: () => {
      currentConnection = null;
      disconnectedListener?.();
    },
  };
};

describe('waitForBridgeDisconnectOrTimeout', () => {
  it('returns true when the bridge disconnects before the timeout', async () => {
    const connection = createConnection();
    const bridge = createBridge(connection);

    const waitPromise = waitForBridgeDisconnectOrTimeout({
      bridge,
      connection,
      timeoutMs: 50,
    });

    bridge.disconnect();

    await expect(waitPromise).resolves.toBe(true);
  });

  it('returns false when the bridge stays connected through the timeout', async () => {
    const connection = createConnection();
    const bridge = createBridge(connection);

    await expect(
      waitForBridgeDisconnectOrTimeout({
        bridge,
        connection,
        timeoutMs: 10,
      }),
    ).resolves.toBe(false);
  });
});
