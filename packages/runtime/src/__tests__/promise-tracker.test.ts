import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTrackedPromises,
  getPendingPromises,
  installPromiseTracker,
  type PromiseTrackerTestContext,
  uninstallPromiseTracker,
  withPromiseTrackerTestContext,
} from '../promise-tracker.js';

afterEach(() => {
  uninstallPromiseTracker();
});

const testContext: PromiseTrackerTestContext = {
  file: 'example.harness.ts',
  suite: 'Example suite',
  name: 'waits forever',
  fullName: 'Example suite waits forever',
  phase: 'test',
};

describe('promise tracker', () => {
  it('tracks pending promises created through the global Promise constructor', () => {
    installPromiseTracker();

    void new Promise(() => undefined);

    const pending = getPendingPromises();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: expect.any(Number),
      createdAt: expect.any(Number),
    });
    expect(pending[0].stack).toContain('Promise created');
  });

  it('removes promises when they resolve', async () => {
    installPromiseTracker();

    await Promise.resolve('done');

    expect(getPendingPromises()).toHaveLength(0);
  });

  it('keeps promises pending while their resolved thenable is pending', () => {
    installPromiseTracker();

    const pendingThenable = new Promise(() => undefined);
    void new Promise((resolve) => resolve(pendingThenable));

    expect(getPendingPromises()).toHaveLength(2);
  });

  it('removes promises when they reject', async () => {
    installPromiseTracker();

    await Promise.reject(new Error('failed')).catch(() => undefined);

    expect(getPendingPromises()).toHaveLength(0);
  });

  it('removes promises when the executor throws', async () => {
    installPromiseTracker();

    await new Promise(() => {
      throw new Error('executor failed');
    }).catch(() => undefined);

    expect(getPendingPromises()).toHaveLength(0);
  });

  it('records the current test context on promises created inside it', async () => {
    installPromiseTracker();

    await withPromiseTrackerTestContext(
      testContext,
      async () => {
        void new Promise(() => undefined);
      }
    );

    expect(getPendingPromises().filter((promise) => promise.test)).toEqual([
      expect.objectContaining({
        test: testContext,
      }),
    ]);
  });

  it('propagates test context to promises created in then callbacks', async () => {
    installPromiseTracker();

    let parent!: Promise<string>;

    await withPromiseTrackerTestContext(testContext, async () => {
      parent = Promise.resolve('ready');
    });

    void parent.then(() => {
      void new Promise(() => undefined);
    });
    await Promise.resolve();

    expect(getPendingPromises().filter((promise) => promise.test)).toEqual([
      expect.objectContaining({
        test: testContext,
      }),
    ]);
  });

  it('propagates test context to promises created in catch callbacks', async () => {
    installPromiseTracker();

    let parent!: Promise<string>;

    await withPromiseTrackerTestContext(testContext, async () => {
      parent = Promise.reject(new Error('failed'));
    });

    void parent.catch(() => {
      void new Promise(() => undefined);
    });
    await Promise.resolve();

    expect(getPendingPromises().filter((promise) => promise.test)).toEqual([
      expect.objectContaining({
        test: testContext,
      }),
    ]);
  });

  it('propagates test context to promises created in finally callbacks', async () => {
    installPromiseTracker();

    let parent!: Promise<string>;

    await withPromiseTrackerTestContext(testContext, async () => {
      parent = Promise.resolve('ready');
    });

    void parent.finally(() => {
      void new Promise(() => undefined);
    });
    await Promise.resolve();

    expect(getPendingPromises().filter((promise) => promise.test)).toEqual([
      expect.objectContaining({
        test: testContext,
      }),
    ]);
  });

  it('clears tracked records without uninstalling the tracker', () => {
    installPromiseTracker();

    void new Promise(() => undefined);
    expect(getPendingPromises()).toHaveLength(1);

    clearTrackedPromises();
    expect(getPendingPromises()).toHaveLength(0);

    void new Promise(() => undefined);
    expect(getPendingPromises()).toHaveLength(1);
  });

  it('restores the original global Promise when uninstalled', () => {
    const originalPromise = globalThis.Promise;

    installPromiseTracker();
    expect(globalThis.Promise).not.toBe(originalPromise);

    uninstallPromiseTracker();
    expect(globalThis.Promise).toBe(originalPromise);
  });
});
