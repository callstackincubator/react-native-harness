import { describe, expect, it } from 'vitest';
import { createHookQueue } from '../hook-queue.js';

describe('createHookQueue', () => {
  it('executes scheduled work in FIFO order', async () => {
    const queue = createHookQueue();
    const order: number[] = [];

    queue.schedule(async () => { order.push(1); });
    queue.schedule(async () => { order.push(2); });
    queue.schedule(async () => { order.push(3); });

    await queue.drain();

    expect(order).toEqual([1, 2, 3]);
  });

  it('drain awaits async work before resolving', async () => {
    const queue = createHookQueue();
    let resolved = false;

    queue.schedule(async () => {
      await new Promise<void>((r) => setTimeout(r, 20));
      resolved = true;
    });

    expect(resolved).toBe(false);
    await queue.drain();
    expect(resolved).toBe(true);
  });

  it('drain resolves immediately when nothing is scheduled', async () => {
    const queue = createHookQueue();
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it('captures the first error and re-throws it on drain', async () => {
    const queue = createHookQueue();
    const err = new Error('hook failed');

    queue.schedule(async () => { throw err; });

    await expect(queue.drain()).rejects.toBe(err);
  });

  it('continues executing subsequent hooks after one throws', async () => {
    const queue = createHookQueue();
    const ran: string[] = [];

    queue.schedule(async () => { throw new Error('first'); });
    queue.schedule(async () => { ran.push('second'); });
    queue.schedule(async () => { ran.push('third'); });

    await expect(queue.drain()).rejects.toThrow('first');

    expect(ran).toEqual(['second', 'third']);
  });

  it('error is cleared after drain re-throws it', async () => {
    const queue = createHookQueue();

    queue.schedule(async () => { throw new Error('once'); });
    await expect(queue.drain()).rejects.toThrow('once');

    // Second drain should see no accumulated error.
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it('surfaces only the first error when multiple hooks throw', async () => {
    const queue = createHookQueue();

    queue.schedule(async () => { throw new Error('first'); });
    queue.schedule(async () => { throw new Error('second'); });

    await expect(queue.drain()).rejects.toThrow('first');
  });
});
