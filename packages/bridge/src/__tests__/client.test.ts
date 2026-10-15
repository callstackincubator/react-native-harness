import { describe, expect, it, vi } from 'vitest';
import { receiveBinary } from '../binary.js';
import { connectToHarness } from '../client.js';
import { createLink, globalClock, type Logger } from '../link/index.js';
import { createConnectionPair } from '../link/__tests__/ports.js';
import type { BridgeMessage } from '../protocol.js';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const setup = async () => {
  const [appEnd, cliEnd] = createConnectionPair();
  const cli = createLink(cliEnd, {
    end: 'gateway',
    clock: globalClock,
    logger: silentLogger,
  });
  const received: BridgeMessage[] = [];
  const waiters: Array<() => void> = [];
  cli.onData((chunk) => {
    received.push(JSON.parse(chunk) as BridgeMessage);
    for (const waiter of waiters.splice(0)) {
      waiter();
    }
  });
  const nextMessage = async (type: BridgeMessage['type']) => {
    for (;;) {
      const message = received.find((candidate) => candidate.type === type);
      if (message) {
        received.splice(received.indexOf(message), 1);
        return message;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  const handle = await connectToHarness(
    'ws://unused',
    { runTests: vi.fn(), resetEnvironment: vi.fn() },
    { transport: appEnd },
  );

  return { cli, handle, nextMessage };
};

describe('connectToHarness', () => {
  it('uses the injected transport instead of constructing a WebSocket', async () => {
    const { handle, nextMessage } = await setup();

    handle.reportReady({
      platform: 'ios',
      manufacturer: 'Apple',
      model: 'Injected',
      osVersion: '18.0',
    });

    expect(await nextMessage('ready')).toMatchObject({
      type: 'ready',
      device: { model: 'Injected' },
    });

    handle.disconnect();
  });

  it('answers pings with pongs', async () => {
    const { cli, handle, nextMessage } = await setup();

    await cli.write(JSON.stringify({ type: 'ping', id: 7 }));

    expect(await nextMessage('pong')).toEqual({ type: 'pong', id: 7 });

    handle.disconnect();
  });

  it('sends screenshot bytes over a link channel, not inside the RPC message', async () => {
    const { cli, handle, nextMessage } = await setup();
    const data = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);

    const transfer = handle.transferScreenshot(data, { width: 10, height: 20 });
    const invoke = await nextMessage('invoke');

    if (invoke.type !== 'invoke') {
      throw new Error('expected an invoke');
    }

    const [reference, metadata] = invoke.args as [
      { channelId: string; size: number },
      unknown,
    ];
    expect(invoke.method).toBe('device.screenshot.receive');
    expect(metadata).toEqual({ width: 10, height: 20 });
    expect(reference.size).toBe(data.length);

    const bytes = await receiveBinary(cli, reference.channelId);
    expect(Buffer.from(bytes).equals(Buffer.from(data))).toBe(true);

    await cli.write(
      JSON.stringify({
        type: 'return',
        id: invoke.id,
        ok: true,
        value: { path: '/tmp/shot.png' },
      }),
    );

    await expect(transfer).resolves.toEqual({ path: '/tmp/shot.png' });

    handle.disconnect();
  });

  it('rejects pending calls once the link closes', async () => {
    const { cli, handle, nextMessage } = await setup();

    const call = handle.matchImageSnapshot(
      { path: '/tmp/shot.png' },
      '/tests/a.test.ts',
      { name: 'a' },
      'ios',
    );
    await nextMessage('invoke');
    await cli.close();

    await expect(call).rejects.toThrow('Harness connection closed');

    handle.disconnect();
  });
});
