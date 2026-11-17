import type { BuildState } from './build-state.js';
import { ManifestNotWatchedError } from './errors.js';

/**
 * How long the compiler may sit idle after the manifest was written, without
 * reporting it, before the folder is taken for ignored. Added to the project's
 * own `aggregateTimeout` and `poll` interval, which are how long its watcher
 * takes to notice a change.
 */
export const IDLE_LIMIT_MS = 5000;

const CHECK_INTERVAL_MS = 25;

/** The default interval webpack polls at for `poll: true`. */
const DEFAULT_POLL_MS = 5007;

/** The idle limit for a project's `watchOptions`. */
export const getIdleLimitMs = (
  watchOptions: { aggregateTimeout?: unknown; poll?: unknown } | undefined
): number => {
  const { aggregateTimeout, poll } = watchOptions ?? {};
  const aggregate = typeof aggregateTimeout === 'number' ? aggregateTimeout : 0;
  const polling =
    typeof poll === 'number' ? poll : poll === true ? DEFAULT_POLL_MS : 0;

  return IDLE_LIMIT_MS + aggregate + polling;
};

/**
 * Resolves true once the manifest was reported changed after `mark` and the
 * compiler has settled, or false once the compiler has been idle for
 * `idleLimitMs` without reporting it. While a change is pending or a build is
 * running the clock does not run: a slow build is not a watcher that is blind.
 */
const waitForReport = ({
  state,
  manifests,
  mark,
  idleLimitMs,
}: {
  state: BuildState;
  manifests: string[];
  mark: number;
  idleLimitMs: number;
}): Promise<boolean> =>
  new Promise((resolve) => {
    const isReported = () =>
      manifests.some((file) => state.wasChangedSince(mark, file));
    let idleSince: number | null = null;
    const timer = setInterval(() => {
      if (isReported() || !state.isSettled()) {
        idleSince = null;
        return;
      }

      idleSince ??= Date.now();

      if (Date.now() - idleSince >= idleLimitMs) {
        finish(false);
      }
    }, CHECK_INTERVAL_MS);
    const finish = (reported: boolean) => {
      clearInterval(timer);
      resolve(reported);
    };

    void state
      .waitUntil(() => isReported() && state.isSettled())
      .then(() => finish(true));
  });

/**
 * Waits for the build that holds a run's files and every edit made before it,
 * in watch mode. `writeManifest` rewrites the manifest with a marker of its
 * own, so its content always changes. The watcher reports that write after the
 * edits before it, and the build it starts reads them all. Returns whether the
 * page the app loaded is older than that build.
 *
 * A watcher that never reports the manifest, because the project's
 * `watchOptions.ignored` covers it, cannot be told from one that is slow
 * except by the compiler sitting idle: that is an error, not something to run
 * on.
 */
export const waitForRunBuild = async ({
  state,
  manifests,
  writeManifest,
  bundlerName,
  idleLimitMs = IDLE_LIMIT_MS,
}: {
  state: BuildState;
  /** The manifest's path, as the compiler may report it (a link and its target). */
  manifests: string[];
  writeManifest: () => void;
  bundlerName: string;
  idleLimitMs?: number;
}): Promise<{ reloadRequired: boolean }> => {
  const mark = state.mark();
  writeManifest();

  if (!(await waitForReport({ state, manifests, mark, idleLimitMs }))) {
    throw new ManifestNotWatchedError(manifests[0], bundlerName);
  }

  return { reloadRequired: state.isPageStale() };
};
