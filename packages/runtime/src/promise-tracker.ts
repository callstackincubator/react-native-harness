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
type PromiseExecutor<T> = (
  resolve: PromiseResolve<T>,
  reject: PromiseReject
) => void;

const pendingPromises = new Map<number, TrackedPromiseRecord>();
const promiseIds = new WeakMap<object, number>();
const promiseContexts = new WeakMap<object, PromiseTrackerTestContext>();

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

  class TrackedPromise<T> extends NativePromise<T> {
    constructor(executor: PromiseExecutor<T>) {
      const registration = registerPromise();

      super((resolve, reject) => {
        try {
          executor(
            (value: T | PromiseLike<T>) => {
              if (isThenable(value)) {
                runWithoutPromiseTracking(() => {
                  NativePromise.resolve(value).then(
                    () => markPromiseSettled(registration.id),
                    () => markPromiseSettled(registration.id)
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
            }
          );
        } catch (error) {
          markPromiseSettled(registration.id);
          throw error;
        }
      });

      if (registration.id !== null) {
        promiseIds.set(this, registration.id);
      }

      if (registration.test) {
        promiseContexts.set(this, registration.test);
      }
    }

    override then<TResult1 = T, TResult2 = never>(
      onfulfilled?:
        | ((value: T) => TResult1 | PromiseLike<TResult1>)
        | undefined
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | undefined
        | null
    ): Promise<TResult1 | TResult2> {
      const context = promiseContexts.get(this);
      const result = runWithoutPromiseTracking(() =>
        super.then(
          wrapPromiseCallback(context, onfulfilled),
          wrapPromiseCallback(context, onrejected)
        )
      ) as Promise<TResult1 | TResult2>;

      if (context && typeof result === 'object') {
        promiseContexts.set(result, context);
      }

      return result;
    }

    override catch<TResult = never>(
      onrejected?:
        | ((reason: unknown) => TResult | PromiseLike<TResult>)
        | undefined
        | null
    ): Promise<T | TResult> {
      const context = promiseContexts.get(this);
      const result = runWithoutPromiseTracking(() =>
        super.catch(wrapPromiseCallback(context, onrejected))
      ) as Promise<T | TResult>;

      if (context && typeof result === 'object') {
        promiseContexts.set(result, context);
      }

      return result;
    }

    override finally(onfinally?: (() => void) | undefined | null): Promise<T> {
      const context = promiseContexts.get(this);

      if (onfinally == null) {
        return this.then();
      }

      return this.then(
        (value) => {
          const result = runWithPromiseTrackerTestContext(context, onfinally);

          return runWithoutPromiseTracking(() =>
            NativePromise.resolve(result).then(() => value)
          );
        },
        (reason: unknown) => {
          const result = runWithPromiseTrackerTestContext(context, onfinally);

          return runWithoutPromiseTracking(() =>
            NativePromise.resolve(result).then(() => {
              throw reason;
            })
          );
        }
      );
    }
  }

  return TrackedPromise as PromiseConstructor;
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
