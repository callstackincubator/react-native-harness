import { describe, expect, it } from 'vitest';
import { createBuildState } from '../build-state.js';

describe('createBuildState', () => {
  it('is settled until a change is reported, and again once the build for it finished', () => {
    const state = createBuildState();

    expect(state.isSettled()).toBe(true);

    state.invalidated();
    expect(state.isSettled()).toBe(false);
    expect(state.isBuilding()).toBe(false);

    state.watchRunStarted(['/p/a.ts']);
    expect(state.isSettled()).toBe(false);
    expect(state.isBuilding()).toBe(true);

    state.buildFinished('a');
    expect(state.isSettled()).toBe(true);
    expect(state.isBuilding()).toBe(false);
  });

  it('is not settled when a change is reported during a build, until the build after it', () => {
    const state = createBuildState();

    state.invalidated();
    state.watchRunStarted(['/p/a.ts']);
    state.invalidated();
    state.buildFinished('a');
    expect(state.isSettled()).toBe(false);

    state.watchRunStarted(['/p/b.ts']);
    state.buildFinished('b');
    expect(state.isSettled()).toBe(true);
  });

  it('remembers a change that arrives between the watch run and the build', () => {
    const state = createBuildState();

    state.watchRunStarted(['/p/a.ts']);
    // The compiler says so again before its `compile` hook runs.
    state.invalidated();
    state.buildFinished('a');

    expect(state.isSettled()).toBe(false);
  });

  it('remembers which files a build was started for after a point in time', () => {
    const state = createBuildState();
    state.watchRunStarted(['/p/a.ts']);
    const mark = state.mark();

    expect(state.wasChangedSince(mark, '/p/a.ts')).toBe(false);

    // Several files can change for one build, though the compiler reports only the first.
    state.watchRunStarted(['/p/b.ts', '/p/manifest.cjs']);
    expect(state.wasChangedSince(mark, '/p/manifest.cjs')).toBe(true);
    expect(state.wasChangedSince(mark, '/p/b.ts')).toBe(true);
    expect(state.wasChangedSince(mark, '/p/a.ts')).toBe(false);
  });

  it('has no stale page before the app loaded one', () => {
    const state = createBuildState();

    state.buildFinished('a');

    expect(state.isPageStale()).toBe(false);
    expect(state.isPageLoaded()).toBe(false);
  });

  it('calls the page stale once a build with another hash finished', () => {
    const state = createBuildState();

    state.buildFinished('a');
    state.pageLoaded();
    expect(state.isPageStale()).toBe(false);

    state.buildFinished('b');
    expect(state.isPageStale()).toBe(true);

    state.pageLoaded();
    expect(state.isPageStale()).toBe(false);
  });

  it('keeps a page that a rebuild left unchanged', () => {
    const state = createBuildState();

    state.buildFinished('a');
    state.pageLoaded();
    state.buildFinished('a');

    expect(state.isPageStale()).toBe(false);
  });

  it('calls the page stale after a build that failed to produce stats', () => {
    const state = createBuildState();

    state.buildFinished('a');
    state.pageLoaded();
    state.buildFinished(null);

    expect(state.isPageStale()).toBe(true);
  });

  it('gives a page loaded during a build the build that finished', () => {
    const state = createBuildState();
    state.buildFinished('a');
    state.pageLoaded();

    state.invalidated();
    state.watchRunStarted(['/p/a.ts']);
    // The middleware answers once the build is valid.
    state.buildFinished('b');
    state.pageLoaded();

    expect(state.isPageStale()).toBe(false);
  });

  describe('waitUntil', () => {
    it('resolves at once when the predicate holds', async () => {
      await createBuildState().waitUntil(() => true);
    });

    it('resolves after the event that makes the predicate hold', async () => {
      const state = createBuildState();
      state.invalidated();
      let done = false;
      const waiting = state.waitUntil(() => state.isSettled()).then(() => {
        done = true;
      });

      state.watchRunStarted([]);
      await Promise.resolve();
      expect(done).toBe(false);

      state.buildFinished('a');
      await waiting;
      expect(done).toBe(true);
    });

    it('resolves every wait on dispose', async () => {
      const state = createBuildState();

      const waiting = state.waitUntil(() => false);
      state.dispose();

      await waiting;
    });
  });
});
