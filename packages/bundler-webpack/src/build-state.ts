/**
 * What the compiler is doing, as its own hooks report it, and which build the
 * app's page came from. Every hook call is an event with a number, so a
 * caller can ask what happened after a point it marked.
 */
export type BuildState = {
  /**
   * Hook `invalid`: a watched file changed, or a rebuild was asked for. The
   * compiler reports only the first change after a build this way, so it
   * marks a build as pending and nothing more.
   */
  invalidated: () => void;
  /**
   * Hook `watchRun`: a build starts, with every file that changed for it.
   * What was reported before is in that build; what is reported after is not.
   */
  watchRunStarted: (changedFiles: Iterable<string>) => void;
  /** Hook `done` or `failed`. */
  buildFinished: (hash: string | null) => void;
  /** The page was served: the app now holds the current build. */
  pageLoaded: () => void;
  /**
   * Whether the page the app loaded was built before the current build. The
   * page keeps the chunks it fetched, so it has to be reloaded to run what
   * the build holds now.
   */
  isPageStale: () => boolean;
  /** Whether the app loaded a page at all. */
  isPageLoaded: () => boolean;
  /** A build is running. The one place that says so. */
  isBuilding: () => boolean;
  /** No change is waiting to be built, and no build is running. */
  isSettled: () => boolean;
  /** A point in time, for the `...Since` questions. */
  mark: () => number;
  /** Whether a build started after `mark` for a change to `file`. */
  wasChangedSince: (mark: number, file: string) => boolean;
  /** Resolves once `predicate` holds, checked after every event. */
  waitUntil: (predicate: () => boolean) => Promise<void>;
  /** Resolves every wait, for a bundler that is shutting down. */
  dispose: () => void;
};

export const createBuildState = (): BuildState => {
  let sequence = 0;
  let dirty = false;
  let building = false;
  let currentHash: string | null = null;
  let pageHash: string | null = null;
  const changes = new Map<string, number>();
  const waiters = new Set<{ predicate: () => boolean; resolve: () => void }>();

  const changed = () => {
    for (const waiter of [...waiters]) {
      if (waiter.predicate()) {
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
  };

  const isSettled = () => !dirty && !building;

  return {
    invalidated: () => {
      sequence += 1;
      dirty = true;
      changed();
    },
    watchRunStarted: (changedFiles) => {
      sequence += 1;
      building = true;
      dirty = false;

      for (const file of changedFiles) {
        changes.set(file, sequence);
      }

      changed();
    },
    buildFinished: (hash) => {
      sequence += 1;
      building = false;
      // A build that failed to produce stats still replaced the one before.
      currentHash = hash ?? `failed:${sequence}`;
      changed();
    },
    pageLoaded: () => {
      pageHash = currentHash;
    },
    isPageStale: () =>
      pageHash !== null && pageHash !== currentHash,
    isPageLoaded: () => pageHash !== null,
    isBuilding: () => building,
    isSettled,
    mark: () => sequence,
    wasChangedSince: (mark, file) => (changes.get(file) ?? -1) > mark,
    waitUntil: (predicate) =>
      predicate()
        ? Promise.resolve()
        : new Promise((resolve) => {
            waiters.add({ predicate, resolve });
          }),
    dispose: () => {
      for (const waiter of waiters) {
        waiter.resolve();
      }
      waiters.clear();
    },
  };
};
