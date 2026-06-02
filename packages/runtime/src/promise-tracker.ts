export type PromiseTrackerTestContext = {
  file: string;
  suite: string;
  name: string;
  fullName: string;
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

const registerPromise = (): number | null => {
  if (trackingDisabledDepth > 0) {
    return null;
  }

  const id = nextPromiseId++;

  pendingPromises.set(id, {
    id,
    createdAt: Date.now(),
    stack: createPromiseStack(),
    test: currentTestContext,
  });

  return id;
};

const markPromiseSettled = (id: number | null) => {
  if (id === null) {
    return;
  }

  pendingPromises.delete(id);
};

const isThenable = <T>(value: T | PromiseLike<T>): value is PromiseLike<T> =>
  value != null &&
  typeof value === 'object' &&
  'then' in value &&
  typeof value.then === 'function';

const createTrackedPromiseConstructor = (): PromiseConstructor => {
  const NativePromise = getOriginalPromise();

  class TrackedPromise<T> extends NativePromise<T> {
    constructor(executor: PromiseExecutor<T>) {
      const id = registerPromise();

      super((resolve, reject) => {
        try {
          executor(
            (value: T | PromiseLike<T>) => {
              if (isThenable(value)) {
                runWithoutPromiseTracking(() => {
                  NativePromise.resolve(value).then(
                    () => markPromiseSettled(id),
                    () => markPromiseSettled(id)
                  );
                });
              } else {
                markPromiseSettled(id);
              }

              resolve(value);
            },
            (reason?: unknown) => {
              markPromiseSettled(id);
              reject(reason);
            }
          );
        } catch (error) {
          markPromiseSettled(id);
          throw error;
        }
      });
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

export const withPromiseTrackerTestContext = async <T>(
  context: PromiseTrackerTestContext,
  work: () => Promise<T>
): Promise<T> => {
  const previousContext = currentTestContext;
  currentTestContext = context;

  try {
    return await work();
  } finally {
    currentTestContext = previousContext;
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
