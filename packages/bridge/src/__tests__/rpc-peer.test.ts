import { describe, expect, it, vi } from 'vitest';
import { createRpcPeer } from '../rpc-peer.js';
import type { BridgeEvents } from '../shared.js';
import type { RpcTransport } from '../transport.js';

type LocalMethods = {
  add: (left: number, right: number) => Promise<number>;
  fail: () => Promise<never>;
};

const createMockTransport = (): RpcTransport & { messages: string[] } => {
  const messages: string[] = [];

  return {
    state: 'open',
    messages,
    send: (message) => {
      messages.push(message);
    },
  };
};

describe('rpc-peer', () => {
  it('resolves successful RPC calls', async () => {
    let serverHandleMessage: ((message: string) => Promise<unknown>) | null = null;

    const client = createRpcPeer<Record<string, never>, { add: LocalMethods['add'] }, BridgeEvents>({
      localMethods: {},
      transport: {
        state: 'open',
        send: (message) => {
          if (!serverHandleMessage) {
            throw new Error('Server peer not initialized');
          }

          void serverHandleMessage(message);
        },
      },
    });

    const server = createRpcPeer<LocalMethods, Record<string, never>, BridgeEvents>({
      localMethods: {
        add: async (left, right) => left + right,
        fail: async () => {
          throw new Error('unused');
        },
      },
      transport: {
        state: 'open',
        send: (message) => {
          void client.handleMessage(message);
        },
      },
    });

    serverHandleMessage = server.handleMessage;

    const result = await client.invoke('add', 2, 3);

    expect(result).toBe(5);
  });

  it('rejects failed RPC calls with restored errors', async () => {
    const client = createRpcPeer<Record<string, never>, { fail: () => Promise<void> }, BridgeEvents>({
      localMethods: {},
      transport: createMockTransport(),
    });

    const server = createRpcPeer<
      { fail: () => Promise<void> },
      Record<string, never>,
      BridgeEvents
    >({
      localMethods: {
        fail: async () => {
          throw new TypeError('boom');
        },
      },
      transport: {
        state: 'open',
        send: (message) => {
          void client.handleMessage(message);
        },
      },
    });

    await server.handleMessage(
      JSON.stringify({ type: 'invoke', id: 1, method: 'fail', args: [] }),
    );

    await expect(client.handleMessage('{"type":"return","id":1,"ok":false,"error":{"name":"TypeError","message":"boom"}}')).resolves.toBeNull();
  });

  it('rejects unknown methods', async () => {
    let response = '';
    const peer = createRpcPeer<Record<string, never>, Record<string, never>, BridgeEvents>({
      localMethods: {},
      transport: {
        state: 'open',
        send: (message) => {
          response = message;
        },
      },
    });

    await peer.handleMessage(
      JSON.stringify({ type: 'invoke', id: 1, method: 'missing', args: [] }),
    );

    expect(JSON.parse(response)).toMatchObject({
      type: 'return',
      id: 1,
      ok: false,
    });
  });

  it('dispatches incoming events', async () => {
    const onEvent = vi.fn();
    const peer = createRpcPeer<Record<string, never>, Record<string, never>, BridgeEvents>({
      localMethods: {},
      transport: createMockTransport(),
      onEvent,
    });

    await peer.handleMessage(
      JSON.stringify({
        type: 'event',
        event: { type: 'collection-started', file: 'example.ts' },
      }),
    );

    expect(onEvent).toHaveBeenCalledWith({
      type: 'collection-started',
      file: 'example.ts',
    });
  });

  it('rejects pending calls when closed', async () => {
    const peer = createRpcPeer<
      Record<string, never>,
      { runTests: (path: string, options: { runner: string }) => Promise<void> },
      BridgeEvents
    >({
      localMethods: {},
      transport: createMockTransport(),
    });

    const pending = peer.invoke('runTests', 'example.ts', { runner: '/runner.js' });
    peer.close(new Error('closed'));

    await expect(pending).rejects.toThrow('closed');
  });

  it('rejects pending calls on timeout', async () => {
    const peer = createRpcPeer<
      Record<string, never>,
      { runTests: (path: string, options: { runner: string }) => Promise<void> },
      BridgeEvents
    >({
      localMethods: {},
      transport: createMockTransport(),
      callTimeoutMs: 10,
      createTimeoutError: () => new Error('timed out'),
    });

    const pending = peer.invoke('runTests', 'example.ts', { runner: '/runner.js' });

    await expect(pending).rejects.toThrow('timed out');
  });

  it('does not time out calls when method-specific timeout returns undefined', async () => {
    const peer = createRpcPeer<
      Record<string, never>,
      { runTests: (path: string, options: { runner: string }) => Promise<void> },
      BridgeEvents
    >({
      localMethods: {},
      transport: createMockTransport(),
      callTimeoutMs: () => undefined,
      createTimeoutError: () => new Error('timed out'),
    });

    let rejected = false;
    const pending = peer.invoke('runTests', 'example.ts', { runner: '/runner.js' });
    pending.catch(() => {
      rejected = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rejected).toBe(false);
    peer.close(new Error('closed'));
    await expect(pending).rejects.toThrow('closed');
  });

  it('throws on malformed messages', async () => {
    const peer = createRpcPeer<Record<string, never>, Record<string, never>, BridgeEvents>({
      localMethods: {},
      transport: createMockTransport(),
    });

    await expect(peer.handleMessage('{"type":"invoke"}')).rejects.toThrow(
      'Invalid bridge message: id must be a number',
    );
  });
});
