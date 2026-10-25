import { omitPromiseFromTracking } from './promise-tracker.js';

export class HostSurfaceReplacedError extends Error {
  constructor(
    public readonly oldRootTag: number,
    public readonly newRootTag: number,
    public readonly file: string,
  ) {
    super(
      `The native test host surface changed from ${oldRootTag} to ${newRootTag} while running ${file}. The Activity or root surface was recreated, so this test file cannot continue.`,
    );
    this.name = 'HostSurfaceReplacedError';
  }
}

let currentRootTag: number | undefined;
let currentSession: TestHostSession | undefined;

export class TestHostSession {
  private interruptedError: HostSurfaceReplacedError | undefined;
  private readonly listeners = new Set<(error: HostSurfaceReplacedError) => void>();

  constructor(public readonly file: string) {}

  get interrupted(): boolean {
    return this.interruptedError !== undefined;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.throwIfInterrupted();

    const result = new Promise<T>((resolve, reject) => {
      const onInterrupted = (error: HostSurfaceReplacedError) => {
        this.listeners.delete(onInterrupted);
        reject(error);
      };
      this.listeners.add(onInterrupted);

      try {
        const workPromise = work();
        workPromise.then(
          (value) => {
            this.listeners.delete(onInterrupted);
            if (this.interruptedError) {
              reject(this.interruptedError);
            } else {
              resolve(value);
            }
          },
          (error: unknown) => {
            this.listeners.delete(onInterrupted);
            reject(error);
          },
        );
      } catch (error) {
        this.listeners.delete(onInterrupted);
        reject(error);
      }
    });
    omitPromiseFromTracking(result);
    return result;
  }

  throwIfInterrupted(): void {
    if (this.interruptedError) {
      throw this.interruptedError;
    }
  }

  interrupt(oldRootTag: number, newRootTag: number): void {
    if (this.interruptedError) {
      return;
    }

    const error = new HostSurfaceReplacedError(oldRootTag, newRootTag, this.file);
    this.interruptedError = error;
    for (const listener of this.listeners) {
      listener(error);
    }
    this.listeners.clear();
  }

  dispose(): void {
    if (currentSession === this) {
      currentSession = undefined;
    }
    this.listeners.clear();
  }
}

export const beginTestHostSession = (file: string): TestHostSession => {
  if (currentSession) {
    throw new Error('A test host session is already active');
  }
  const session = new TestHostSession(file);
  currentSession = session;
  return session;
};

export const getCurrentTestHostSession = (): TestHostSession | undefined =>
  currentSession;

export const observeTestHostSurface = (rootTag: number): void => {
  if (!Number.isInteger(rootTag) || rootTag <= 0 || rootTag === currentRootTag) {
    return;
  }

  const previousRootTag = currentRootTag;
  currentRootTag = rootTag;
  if (previousRootTag !== undefined) {
    currentSession?.interrupt(previousRootTag, rootTag);
  }
};
