import { describe, expect, it, vi } from 'vitest';
import { createBuildState } from '../build-state.js';
import { ManifestNotWatchedError } from '../errors.js';
import { getIdleLimitMs, waitForRunBuild } from '../watch-run.js';

const MANIFEST = '/p/.harness/test-files.cjs';

const setup = () => {
  const state = createBuildState();
  const run = (overrides: Partial<Parameters<typeof waitForRunBuild>[0]> = {}) =>
    waitForRunBuild({
      state,
      manifests: [MANIFEST],
      writeManifest: vi.fn(),
      bundlerName: 'webpack',
      idleLimitMs: 100,
      ...overrides,
    });

  return { state, run };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('getIdleLimitMs', () => {
  it('adds how long the project\'s watcher takes to notice a change', () => {
    expect(getIdleLimitMs(undefined)).toBe(5000);
    expect(getIdleLimitMs({ aggregateTimeout: 6000 })).toBe(11000);
    expect(getIdleLimitMs({ poll: 1000 })).toBe(6000);
    expect(getIdleLimitMs({ poll: true })).toBe(10007);
    expect(getIdleLimitMs({ poll: false, aggregateTimeout: 'x' })).toBe(5000);
  });
});

describe('waitForRunBuild', () => {
  it('waits for the build that the manifest write started, and asks for a reload of a stale page', async () => {
    const { state, run } = setup();
    state.buildFinished('a');
    state.pageLoaded();
    let resolved = false;

    const waiting = run({
      writeManifest: () => {
        setTimeout(() => {
          state.invalidated();
          state.watchRunStarted(['/p/src/a.ts', MANIFEST]);
          setTimeout(() => state.buildFinished('b'), 30);
        }, 5);
      },
    }).then((result) => {
      resolved = true;
      return result;
    });

    await sleep(15);
    expect(resolved).toBe(false);
    expect(await waiting).toEqual({ reloadRequired: true });
  });

  it('does not take a build that started before the write for the one that holds it', async () => {
    const { state, run } = setup();
    state.buildFinished('a');
    state.pageLoaded();
    // A build of an earlier edit is running when the manifest is written.
    state.invalidated();
    state.watchRunStarted(['/p/src/a.ts']);
    let resolved = false;

    const waiting = run({ idleLimitMs: 1000 }).then((result) => {
      resolved = true;
      return result;
    });
    setTimeout(() => state.buildFinished('b'), 10);
    await sleep(40);

    expect(resolved).toBe(false);

    state.invalidated();
    state.watchRunStarted([MANIFEST]);
    state.buildFinished('c');

    expect(await waiting).toEqual({ reloadRequired: true });
  });

  it('asks for no reload when the app has loaded no page', async () => {
    const { state, run } = setup();
    state.buildFinished('a');

    const waiting = run({
      writeManifest: () => {
        setTimeout(() => {
          state.watchRunStarted([MANIFEST]);
          state.buildFinished('b');
        }, 5);
      },
    });

    expect(await waiting).toEqual({ reloadRequired: false });
  });

  describe('the idle clock', () => {
    it('does not run while a change is pending', async () => {
      const { state, run } = setup();
      state.buildFinished('a');
      state.invalidated();
      let failed = false;

      const waiting = run().catch((error: unknown) => {
        failed = true;
        throw error;
      });
      waiting.catch(() => undefined);
      await sleep(300);

      expect(failed).toBe(false);

      state.watchRunStarted([MANIFEST]);
      state.buildFinished('b');
      expect(await waiting).toEqual({ reloadRequired: false });
    });

    it('does not run while a build is running, however long it takes', async () => {
      const { state, run } = setup();
      state.buildFinished('a');
      state.invalidated();
      state.watchRunStarted(['/p/src/slow.ts']);
      let failed = false;

      const waiting = run().catch((error: unknown) => {
        failed = true;
        throw error;
      });
      waiting.catch(() => undefined);
      await sleep(300);

      expect(failed).toBe(false);

      state.invalidated();
      state.watchRunStarted([MANIFEST]);
      state.buildFinished('b');
      await waiting;
    });

    it('starts over when the compiler goes idle again', async () => {
      const { state, run } = setup();
      state.buildFinished('a');
      state.invalidated();
      state.watchRunStarted(['/p/src/a.ts']);
      let failed = false;

      const waiting = run({ idleLimitMs: 150 }).catch((error: unknown) => {
        failed = true;
        throw error;
      });
      waiting.catch(() => undefined);
      await sleep(200);
      // The earlier build ends after the limit, and the clock only starts then.
      state.buildFinished('b');
      await sleep(60);
      expect(failed).toBe(false);

      await expect(waiting).rejects.toBeInstanceOf(ManifestNotWatchedError);
    });

    it('fails with the reason once the compiler has been idle for the limit', async () => {
      const { state, run } = setup();
      state.buildFinished('a');
      state.pageLoaded();

      const failure = await run().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ManifestNotWatchedError);
      expect((failure as Error).message).toContain(MANIFEST);
      expect((failure as Error).message).toContain('watchOptions.ignored');
      expect((failure as Error).message).toContain('must not be ignored');
      expect((failure as Error).message).toContain('change the config and start Harness again');
    });
  });

  it('recovers after a failed build, by the next one', async () => {
    const { state, run } = setup();
    state.buildFinished('a');
    state.pageLoaded();
    const report = (hash: string | null) =>
      setTimeout(() => {
        state.invalidated();
        state.watchRunStarted([MANIFEST]);
        state.buildFinished(hash);
      }, 5);

    expect(await run({ writeManifest: () => report(null) })).toEqual({ reloadRequired: true });

    state.pageLoaded();
    expect(await run({ writeManifest: () => report('c') })).toEqual({ reloadRequired: true });
  });
});
