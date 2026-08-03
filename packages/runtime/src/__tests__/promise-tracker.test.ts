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

  it('preserves native Promise instances created through the global constructor', () => {
    const NativePromise = globalThis.Promise;
    installPromiseTracker();

    const promise = new Promise(() => undefined);

    expect(Object.getPrototypeOf(promise)).toBe(NativePromise.prototype);
    expect(promise).toBeInstanceOf(Promise);
    expect(promise.constructor).toBe(Promise);
    expect(Promise.resolve(promise)).toBe(promise);
    expect(Object.keys(promise)).toEqual([]);
  });

  it('preserves custom Promise subclass behavior', async () => {
    installPromiseTracker();

    let usedCustomThen = false;
    class CustomPromise<T> extends Promise<T> {
      override then<TResult1 = T, TResult2 = never>(
        onfulfilled?:
          | ((value: T) => TResult1 | PromiseLike<TResult1>)
          | undefined
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | undefined
          | null,
      ): Promise<TResult1 | TResult2> {
        usedCustomThen = true;
        return super.then(onfulfilled, onrejected);
      }
    }

    const promise = new CustomPromise<number>((resolve) => resolve(55));

    expect(Object.getPrototypeOf(promise)).toBe(CustomPromise.prototype);
    expect(promise).toBeInstanceOf(CustomPromise);
    expect(promise.constructor).toBe(CustomPromise);
    expect(CustomPromise.resolve(promise)).toBe(promise);
    await expect(promise.then((value) => value)).resolves.toBe(55);
    expect(usedCustomThen).toBe(true);
  });

  it('removes promises when they resolve', async () => {
    installPromiseTracker();

    await Promise.resolve('done');

    expect(getPendingPromises()).toHaveLength(0);
  });

  it('preserves native Promise static method behavior', async () => {
    const NativePromise = globalThis.Promise;
    installPromiseTracker();

    const resolvedValue = Promise.resolve(55);
    const resolvedUndefined = Promise.resolve();
    const rejected = Promise.reject('failed');
    const all = Promise.all([55]);
    const allSettled = Promise.allSettled([55]);
    const any = Promise.any([55]);
    const race = Promise.race([55]);
    const nativeWithResolvers: unknown = Reflect.get(
      NativePromise,
      'withResolvers',
    );
    const trackedWithResolvers: unknown = Reflect.get(
      Promise,
      'withResolvers',
    );
    const withResolvers =
      typeof nativeWithResolvers === 'function' &&
      typeof trackedWithResolvers === 'function'
        ? (Reflect.apply(trackedWithResolvers, Promise, []) as {
            promise: Promise<number>;
            resolve: (value: number) => void;
          })
        : null;
    const nativeTry: unknown = Reflect.get(NativePromise, 'try');
    const trackedTry: unknown = Reflect.get(Promise, 'try');
    const tried =
      typeof nativeTry === 'function' && typeof trackedTry === 'function'
        ? (Reflect.apply(trackedTry, Promise, [() => 55]) as Promise<number>)
        : null;
    const rejectedAssertion = expect(rejected).rejects.toBe('failed');

    for (const promise of [
      resolvedValue,
      resolvedUndefined,
      rejected,
      all,
      allSettled,
      any,
      race,
      ...(withResolvers ? [withResolvers.promise] : []),
      ...(tried ? [tried] : []),
    ]) {
      expect(Object.getPrototypeOf(promise)).toBe(NativePromise.prototype);
    }

    withResolvers?.resolve(55);

    await expect(resolvedValue).resolves.toBe(55);
    await expect(resolvedUndefined).resolves.toBeUndefined();
    await rejectedAssertion;
    await expect(all).resolves.toEqual([55]);
    await expect(allSettled).resolves.toEqual([
      { status: 'fulfilled', value: 55 },
    ]);
    await expect(any).resolves.toBe(55);
    await expect(race).resolves.toBe(55);
    if (withResolvers) {
      await expect(withResolvers.promise).resolves.toBe(55);
    }
    if (tried) {
      await expect(tried).resolves.toBe(55);
    }
  });

  it('resolves values when Promise.resolve is invoked without a receiver', async () => {
    installPromiseTracker();

    const resolve = Promise.resolve;

    await expect(Reflect.apply(resolve, undefined, [55])).resolves.toBe(55);
    await expect(Reflect.apply(resolve, undefined, [])).resolves.toBeUndefined();
    await expect(
      Reflect.apply(resolve, undefined, [undefined]),
    ).resolves.toBeUndefined();
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
