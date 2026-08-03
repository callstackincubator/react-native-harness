export type PromiseTrackerTestContext = {
  file: string;
  suite: string;
  name: string;
  fullName: string;
  phase?: 'beforeAll' | 'beforeEach' | 'test' | 'afterEach' | 'afterAll';
};

export type TrackedPromiseRecord = {
  id: number;
  createdAt: number;
  stack?: string;
  test?: PromiseTrackerTestContext;
};

type PromiseResolve<T> = (value: T | PromiseLike<T>) => void;
type PromiseReject = (reason?: unknown) => void;

// Backstop against unbounded growth if GC can't keep up: never-settling
// promises created in a hot loop would otherwise OOM the heap. Diagnostics only
// ever show a handful, so evicting the oldest (Map keeps insertion order) is safe.
export const MAX_TRACKED_PROMISES = 10_000;

const pendingPromises = new Map<number, TrackedPromiseRecord>();
const promiseIds = new WeakMap<object, number>();
const promiseContexts = new WeakMap<object, PromiseTrackerTestContext>();

// A garbage-collected promise can never settle or hold anything pending, so drop
// its record (and captured stack) instead of leaking it. Primary defense; the
// size cap above covers the window before GC runs.
const promiseFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? null
    : new FinalizationRegistry<number>((id) => {
        pendingPromises.delete(id);
      });

let originalPromise: PromiseConstructor | null = null;
let nextPromiseId = 1;
let currentTestContext: PromiseTrackerTestContext | undefined;
let trackingDisabledDepth = 0;

const getOriginalPromise = (): PromiseConstructor =>
  originalPromise ?? globalThis.Promise;

const createPromiseStack = (): string | undefined => {
  try {
    return new Error('Promise created').stack;
  } catch {
    return undefined;
  }
};

const cloneTestContext = (
  context: PromiseTrackerTestContext
): PromiseTrackerTestContext => ({ ...context });

const getCurrentPromiseContext = (): PromiseTrackerTestContext | undefined =>
  currentTestContext ? cloneTestContext(currentTestContext) : undefined;

const registerPromise = ():
  | { id: number; test?: PromiseTrackerTestContext }
  | { id: null; test?: undefined } => {
  if (trackingDisabledDepth > 0) {
    return { id: null };
  }

  const id = nextPromiseId++;
  const test = getCurrentPromiseContext();

  pendingPromises.set(id, {
    id,
    createdAt: Date.now(),
    stack: createPromiseStack(),
    test,
  });

  while (pendingPromises.size > MAX_TRACKED_PROMISES) {
    const oldest = pendingPromises.keys().next().value;
    if (oldest === undefined) {
      break;
    }

    pendingPromises.delete(oldest);
  }

  return { id, test };
};

const markPromiseSettled = (id: number | null) => {
  if (id === null) {
    return;
  }

  pendingPromises.delete(id);
};

export const omitPromiseFromTracking = (promise: unknown): void => {
  if (promise == null || typeof promise !== 'object') {
    return;
  }

  const id = promiseIds.get(promise);

  if (id === undefined) {
    return;
  }

  pendingPromises.delete(id);
};

const isThenable = <T>(value: T | PromiseLike<T>): value is PromiseLike<T> =>
  value != null &&
  typeof value === 'object' &&
  'then' in value &&
  typeof value.then === 'function';

const runWithPromiseTrackerTestContext = <T>(
  context: PromiseTrackerTestContext | undefined,
  work: () => T
): T => {
  if (!context) {
    return work();
  }

  const previousContext = currentTestContext;
  currentTestContext = context;

  try {
    return work();
  } finally {
    currentTestContext = previousContext;
  }
};

const wrapPromiseCallback = <TArgs extends unknown[], TResult>(
  context: PromiseTrackerTestContext | undefined,
  callback: ((...args: TArgs) => TResult) | undefined | null
): ((...args: TArgs) => TResult) | undefined => {
  if (callback == null) {
    return undefined;
  }

  return (...args) => runWithPromiseTrackerTestContext(context, () => callback(...args));
};

const createTrackedPromiseConstructor = (): PromiseConstructor => {
  const NativePromise = getOriginalPromise();

  const staticPromiseMethods = new Set<PropertyKey>([
    'resolve',
    'reject',
    'all',
    'allSettled',
    'any',
    'race',
    'try',
    'withResolvers',
  ]);
  const staticMethodWrappers = new Map<
    PropertyKey,
    { method: unknown; wrapper: unknown }
  >();

  function propagatePromiseContext<T>(
    promise: Promise<T>,
    context: PromiseTrackerTestContext | undefined,
    decorate = false,
  ): Promise<T> {
    if (context) {
      promiseContexts.set(promise, context);
    }

    if ((context || decorate) && Object.isExtensible(promise)) {
      const properties: PropertyDescriptorMap = {};

      if (promise.then === NativePromise.prototype.then) {
        properties.then = {
          configurable: true,
          writable: true,
          value: trackedThen,
        };
      }

      if (promise.catch === NativePromise.prototype.catch) {
        properties.catch = {
          configurable: true,
          writable: true,
          value: trackedCatch,
        };
      }

      if (promise.finally === NativePromise.prototype.finally) {
        properties.finally = {
          configurable: true,
          writable: true,
          value: trackedFinally,
        };
      }

      Object.defineProperties(promise, properties);
    }

    return promise;
  }

  function trackedThen<T, TResult1 = T, TResult2 = never>(
    this: Promise<T>,
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    const context = promiseContexts.get(this);
    const result = runWithoutPromiseTracking(() =>
      NativePromise.prototype.then.call(
        this,
        wrapPromiseCallback(context, onfulfilled),
        wrapPromiseCallback(context, onrejected),
      ),
    ) as Promise<TResult1 | TResult2>;

    return propagatePromiseContext(result, context, true);
  }

  function trackedCatch<T, TResult = never>(
    this: Promise<T>,
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
  ): Promise<T | TResult> {
    return trackedThen.call(this, undefined, onrejected) as Promise<T | TResult>;
  }

  function trackedFinally<T>(
    this: Promise<T>,
    onfinally?: (() => void) | undefined | null,
  ): Promise<T> {
    const context = promiseContexts.get(this);

    if (onfinally == null) {
      return trackedThen.call(this) as Promise<T>;
    }

    return trackedThen.call(
      this,
      (value: unknown) => {
        const result = runWithPromiseTrackerTestContext(context, onfinally);

        return runWithoutPromiseTracking(() =>
          NativePromise.resolve(result).then(() => value as T),
        );
      },
      (reason: unknown) => {
        const result = runWithPromiseTrackerTestContext(context, onfinally);

        return runWithoutPromiseTracking(() =>
          NativePromise.resolve(result).then(() => {
            throw reason;
          }),
        );
      },
    ) as Promise<T>;
  }

  const handler: ProxyHandler<PromiseConstructor> = {
    construct(target, args, newTarget) {
      const executor = args[0];

      if (typeof executor !== 'function') {
        return Reflect.construct(target, args, newTarget);
      }

      const registration = registerPromise();
      let promise: Promise<unknown>;

      try {
        promise = Reflect.construct(
          target,
          [
            (resolve: PromiseResolve<unknown>, reject: PromiseReject) => {
              try {
                executor(
                  (value: unknown | PromiseLike<unknown>) => {
                    if (isThenable(value)) {
                      runWithoutPromiseTracking(() => {
                        NativePromise.resolve(value).then(
                          () => markPromiseSettled(registration.id),
                          () => markPromiseSettled(registration.id),
                        );
                      });
                    } else {
                      markPromiseSettled(registration.id);
                    }

                    resolve(value);
                  },
                  (reason?: unknown) => {
                    markPromiseSettled(registration.id);
                    reject(reason);
                  },
                );
              } catch (error) {
                markPromiseSettled(registration.id);
                throw error;
              }
            },
          ],
          newTarget,
        ) as Promise<unknown>;
      } catch (error) {
        markPromiseSettled(registration.id);
        throw error;
      }

      if (newTarget === TrackedPromise && Object.isExtensible(promise)) {
        Object.defineProperty(promise, 'constructor', {
          configurable: true,
          writable: true,
          value: TrackedPromise,
        });
      }

      if (registration.id !== null) {
        promiseIds.set(promise, registration.id);
        promiseFinalization?.register(promise, registration.id);
      }

      return propagatePromiseContext(promise, registration.test, true);
    },
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);

      if (
        receiver !== TrackedPromise ||
        !staticPromiseMethods.has(property) ||
        typeof value !== 'function'
      ) {
        return value;
      }

      const cached = staticMethodWrappers.get(property);
      if (cached?.method === value) {
        return cached.wrapper;
      }

      const wrapper = function (this: unknown, ...args: unknown[]) {
        const methodReceiver = this == null ? NativePromise : this;
        const result: unknown = Reflect.apply(value, methodReceiver, args);
        const context = getCurrentPromiseContext();

        if (property === 'withResolvers') {
          const capability = result as { promise: Promise<unknown> };
          propagatePromiseContext(capability.promise, context);
          return capability;
        }

        return propagatePromiseContext(result as Promise<unknown>, context);
      };

      staticMethodWrappers.set(property, { method: value, wrapper });
      return wrapper;
    },
  };

  const TrackedPromise = new Proxy(NativePromise, handler);
  return TrackedPromise;
};

export const installPromiseTracker = (): void => {
  if (originalPromise) {
    return;
  }

  originalPromise = globalThis.Promise;
  globalThis.Promise = createTrackedPromiseConstructor();
};

export const uninstallPromiseTracker = (): void => {
  if (!originalPromise) {
    return;
  }

  globalThis.Promise = originalPromise;
  originalPromise = null;
  pendingPromises.clear();
  // WeakMap entries are released with their promises.
  currentTestContext = undefined;
};

export const clearTrackedPromises = (): void => {
  pendingPromises.clear();
};

export const getPendingPromises = (): TrackedPromiseRecord[] => {
  return [...pendingPromises.values()].map((record) => ({
    ...record,
    test: record.test ? { ...record.test } : undefined,
  }));
};

export const withPromiseTrackerTestContext = <T>(
  context: PromiseTrackerTestContext,
  work: () => Promise<T>,
  options: {
    omitReturnedPromise?: boolean;
  } = {},
): Promise<T> => {
  const previousContext = currentTestContext;
  currentTestContext = context;

  try {
    const result = work();

    if (options.omitReturnedPromise) {
      omitPromiseFromTracking(result);
    }

    return runWithoutPromiseTracking(() =>
      Promise.resolve(result).finally(() => {
        currentTestContext = previousContext;
      }),
    );
  } catch (error) {
    currentTestContext = previousContext;
    return runWithoutPromiseTracking(() => Promise.reject(error));
  }
};

export const runWithoutPromiseTracking = <T>(work: () => T): T => {
  trackingDisabledDepth += 1;

  try {
    return work();
  } finally {
    trackingDisabledDepth -= 1;
  }
};
