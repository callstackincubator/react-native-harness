import { describe, expect, it, vi } from 'vitest';
import type { BundlerEvent } from '@react-native-harness/bundlers';
import { observeCompiler } from '../bundler-events.js';
import type { CompilerStats } from '../types.js';

// A compiler whose hooks run what was tapped, the way tapable's do.
const createFakeCompiler = () => {
  const taps: Record<string, Array<(...args: never[]) => void>> = {
    invalid: [],
    watchRun: [],
    compile: [],
    done: [],
    failed: [],
  };
  const hook = (name: string) => ({
    tap: (_: string, callback: (...args: never[]) => void) => {
      taps[name].push(callback);
    },
  });

  return {
    compiler: {
      hooks: { invalid: hook('invalid'), watchRun: hook('watchRun'), compile: hook('compile'), done: hook('done'), failed: hook('failed') },
    },
    invalid: () => taps.invalid.forEach((callback) => callback()),
    watchRun: (compiler: object) => taps.watchRun.forEach((callback) => callback(compiler as never)),
    compile: () => taps.compile.forEach((callback) => callback()),
    done: (stats: CompilerStats) =>
      taps.done.forEach((callback) => callback(stats as never)),
    failed: (error: Error) =>
      taps.failed.forEach((callback) => callback(error as never)),
  };
};

const stats = (hasErrors: boolean): CompilerStats => ({
  toJson: () => ({}),
  hasErrors: () => hasErrors,
  toString: () => 'errors',
});

const setup = () => {
  const fake = createFakeCompiler();
  const events: BundlerEvent[] = [];
  const onBuildFinished = vi.fn();
  const observer = observeCompiler({
    compiler: fake.compiler as never,
    platform: 'web',
    entryFile: './src/index.tsx',
    emit: (event) => events.push(event),
    onBuildFinished,
  });

  return { fake, events, onBuildFinished, observer };
};

describe('observeCompiler', () => {
  it('reports a compilation that succeeds as a started and a finished build', () => {
    const { fake, events } = setup();

    fake.compile();
    fake.done(stats(false));

    expect(events).toEqual([
      {
        type: 'build_started',
        buildId: 'webpack-1',
        platform: 'web',
        entryFile: './src/index.tsx',
        dev: true,
      },
      { type: 'build_done', buildId: 'webpack-1' },
    ]);
  });

  it('reports a compilation with errors as a failed build', () => {
    const { fake, events, onBuildFinished } = setup();
    const failedStats = stats(true);

    fake.compile();
    fake.done(failedStats);

    expect(events[1]).toEqual({ type: 'build_failed', buildId: 'webpack-1' });
    expect(onBuildFinished).toHaveBeenCalledWith({ ok: false, stats: failedStats });
  });

  it('reports a compiler that fails as a failed build', () => {
    const { fake, events, onBuildFinished } = setup();

    fake.compile();
    fake.failed(new Error('boom'));

    expect(events[1]).toEqual({ type: 'build_failed', buildId: 'webpack-1' });
    expect(onBuildFinished).toHaveBeenCalledWith({ ok: false, stats: undefined });
  });

  it('gives each compilation its own id', () => {
    const { fake, events } = setup();

    fake.compile();
    fake.done(stats(false));
    fake.compile();
    fake.done(stats(false));

    expect(events.map((event) => ('buildId' in event ? event.buildId : null))).toEqual([
      'webpack-1',
      'webpack-1',
      'webpack-2',
      'webpack-2',
    ]);
  });

  it('tells the caller when a build finishes, after the event', () => {
    const { fake, events, onBuildFinished } = setup();
    onBuildFinished.mockImplementation(() => {
      expect(events.at(-1)?.type).toBe('build_done');
    });

    fake.compile();
    fake.done(stats(false));

    expect(onBuildFinished).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true })
    );
  });

  it('stops reporting once disposed', () => {
    const { fake, events, observer } = setup();

    observer.dispose();
    fake.compile();
    fake.done(stats(false));

    expect(events).toEqual([]);
  });
});

describe('observeCompiler watching', () => {
  it('reports a change, and the files that changed for the build that follows', () => {
    const fake = createFakeCompiler();
    const onInvalid = vi.fn();
    const onWatchRun = vi.fn();
    observeCompiler({
      compiler: fake.compiler as never,
      platform: 'web',
      entryFile: './x',
      emit: () => undefined,
      onInvalid,
      onWatchRun,
    });

    fake.invalid();
    fake.watchRun({ modifiedFiles: new Set(['/p/a.ts', '/p/b.ts']) });
    fake.watchRun({});

    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onWatchRun.mock.calls).toEqual([[new Set(['/p/a.ts', '/p/b.ts'])], [new Set()]]);
  });
});
