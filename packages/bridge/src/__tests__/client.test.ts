import { describe, expect, it, vi } from 'vitest';
import { connectToHarness } from '../client.js';
import type {
  BridgeTransport,
  BridgeTransportCloseEvent,
  BridgeTransportMessage,
  BridgeTransportState,
} from '../transport.js';

const createMockTransport = (initialState: BridgeTransportState = 'connecting') => {
  let state = initialState;
  const openListeners = new Set<() => void>();
  const messageListeners = new Set<(message: BridgeTransportMessage) => void>();
  const closeListeners = new Set<(event: BridgeTransportCloseEvent) => void>();
  const errorListeners = new Set<(error: Error) => void>();
  const sent: BridgeTransportMessage[] = [];

  const transport: BridgeTransport = {
    get state() {
      return state;
    },
    send: (message) => {
      sent.push(message);
    },
    close: (code = 1000, reason = '') => {
      state = 'closed';
      for (const listener of closeListeners) {
        listener({ code, reason });
      }
    },
    onOpen: (listener) => {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
    onMessage: (listener) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    onError: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
  };

  return {
    transport,
    sent,
    open: () => {
      state = 'open';
      for (const listener of openListeners) {
        listener();
      }
    },
    receive: (message: BridgeTransportMessage) => {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
    fail: (error: Error) => {
      for (const listener of errorListeners) {
        listener(error);
      }
    },
  };
};

describe('connectToHarness transport injection', () => {
  it('uses the injected transport instead of constructing a WebSocket', async () => {
    const mockTransport = createMockTransport();
    const handlePromise = connectToHarness(
      'ws://unused',
      { runTests: vi.fn() },
      { transport: mockTransport.transport },
    );

    mockTransport.open();

    const handle = await handlePromise;
    handle.reportReady({
      platform: 'ios',
      manufacturer: 'Apple',
      model: 'Injected',
      osVersion: '18.0',
    });

    expect(mockTransport.sent).toHaveLength(1);
    expect(mockTransport.sent[0]).toBeTypeOf('string');
    expect(JSON.parse(mockTransport.sent[0] as string)).toMatchObject({
      type: 'ready',
      device: { model: 'Injected' },
    });

    handle.disconnect();
  });
});
