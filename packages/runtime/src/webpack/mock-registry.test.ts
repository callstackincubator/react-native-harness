import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWebpackRequire } from './__tests__/fake-webpack.js';
import {
  createMockRegistry,
  forgetMockRegistryForTests,
} from './mock-registry.js';
import type { WebpackRequire } from './webpack-require.js';

describe('webpack mock registry', () => {
  let runs: Record<string, number>;
  let webpackRequire: WebpackRequire;

  const defineModule = (name: string, exports: Record<string, unknown>) => ({
    [name]: (module: { exports: unknown }) => {
      runs[name] = (runs[name] ?? 0) + 1;
      module.exports = exports;
    },
  });

  beforeEach(() => {
    runs = {};
    webpackRequire = createFakeWebpackRequire({
      ...defineModule('./dep.js', { value: 'real' }),
      ...defineModule('./other.js', { value: 'other' }),
      './consumer.js': (module, _exports, require) => {
        runs['./consumer.js'] = (runs['./consumer.js'] ?? 0) + 1;
        module.exports = { dep: require('./dep.js') };
      },
    });
    vi.stubGlobal('__webpack_require__', webpackRequire);
    forgetMockRegistryForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves the module cache and the module factories alone until used', () => {
    createMockRegistry();

    expect(webpackRequire.i).toHaveLength(1);
    expect(webpackRequire('./dep.js')).toEqual({ value: 'real' });
    expect(runs['./dep.js']).toBe(1);
  });

  it('returns the same registry and intercepts only once', () => {
    const first = createMockRegistry();

    expect(createMockRegistry()).toBe(first);
    expect(webpackRequire.i).toHaveLength(1);
  });

  it('explains what is missing when the build has no interceptors', () => {
    delete webpackRequire.i;

    expect(() => createMockRegistry()).toThrow(/plugin/);
  });

  it('serves the mock to a module that has not run yet', () => {
    const { mock } = createMockRegistry();
    mock('./dep.js', () => ({ value: 'mocked' }));

    expect(webpackRequire('./consumer.js')).toEqual({
      dep: { value: 'mocked' },
    });
    expect(runs['./dep.js']).toBeUndefined();
  });

  it('runs the mock factory once and caches its result', () => {
    const { mock } = createMockRegistry();
    const factory = vi.fn(() => ({ value: 'mocked' }));
    mock('./dep.js', factory);

    webpackRequire('./dep.js');
    webpackRequire('./dep.js');

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('runs the factory again when a module is mocked again', () => {
    const { mock } = createMockRegistry();
    mock('./dep.js', () => ({ value: 'first' }));
    webpackRequire('./dep.js');
    mock('./dep.js', () => ({ value: 'second' }));

    expect(webpackRequire('./dep.js')).toEqual({ value: 'second' });
  });

  it('does not touch a module that already ran: its dependants keep the binding', () => {
    const { mock } = createMockRegistry();
    const consumer = webpackRequire('./consumer.js') as { dep: unknown };

    mock('./dep.js', () => ({ value: 'mocked' }));

    expect(consumer.dep).toEqual({ value: 'real' });
    expect(webpackRequire('./dep.js')).toEqual({ value: 'mocked' });
  });

  it('requireActual returns the real module while it is mocked', () => {
    const { mock, requireActual } = createMockRegistry();
    mock('./dep.js', () => ({ value: 'mocked' }));

    expect(requireActual('./dep.js')).toEqual({ value: 'real' });
    expect(webpackRequire('./dep.js')).toEqual({ value: 'mocked' });
  });

  it('requireActual evaluates the real module once', () => {
    const { mock, requireActual } = createMockRegistry();
    mock('./dep.js', () => ({ value: 'mocked' }));

    expect(requireActual('./dep.js')).toBe(requireActual('./dep.js'));
    expect(runs['./dep.js']).toBe(1);
  });

  it('requireActual of a module that is not mocked is a plain require', () => {
    const { requireActual } = createMockRegistry();

    expect(requireActual('./other.js')).toBe(webpackRequire('./other.js'));
    expect(runs['./other.js']).toBe(1);
  });

  it('unmock gives back the real module that was loaded before the mock', () => {
    const { mock, unmock } = createMockRegistry();
    const before = webpackRequire('./dep.js');

    mock('./dep.js', () => ({ value: 'mocked' }));
    webpackRequire('./dep.js');
    unmock('./dep.js');

    expect(webpackRequire('./dep.js')).toBe(before);
    expect(runs['./dep.js']).toBe(1);
  });

  it('unmock runs a real module that was never loaded, once', () => {
    const { mock, unmock } = createMockRegistry();

    mock('./dep.js', () => ({ value: 'mocked' }));
    webpackRequire('./dep.js');
    unmock('./dep.js');

    expect(webpackRequire('./dep.js')).toEqual({ value: 'real' });
    expect(runs['./dep.js']).toBe(1);
  });

  it('unmock of a module that was never mocked changes nothing', () => {
    const { unmock } = createMockRegistry();
    const before = webpackRequire('./other.js');

    unmock('./other.js');

    expect(webpackRequire('./other.js')).toBe(before);
    expect(runs['./other.js']).toBe(1);
  });

  describe('resetModules', () => {
    it('removes every mock and restores the real modules', () => {
      const { mock, resetModules } = createMockRegistry();
      const before = webpackRequire('./dep.js');
      mock('./dep.js', () => ({ value: 'mocked' }));
      mock('./other.js', () => ({ value: 'mocked' }));
      webpackRequire('./other.js');

      resetModules();

      expect(webpackRequire('./dep.js')).toBe(before);
      expect(webpackRequire('./other.js')).toEqual({ value: 'other' });
    });

    it('does not clear modules that were never mocked', () => {
      const { mock, resetModules } = createMockRegistry();
      const consumer = webpackRequire('./consumer.js');
      mock('./other.js', () => ({ value: 'mocked' }));

      resetModules();

      expect(webpackRequire.c['./consumer.js']).toBeDefined();
      expect(webpackRequire('./consumer.js')).toBe(consumer);
      expect(runs['./consumer.js']).toBe(1);
    });

    it('lets a module be mocked again afterwards', () => {
      const { mock, resetModules } = createMockRegistry();
      mock('./dep.js', () => ({ value: 'first' }));
      resetModules();
      mock('./dep.js', () => ({ value: 'second' }));

      expect(webpackRequire('./dep.js')).toEqual({ value: 'second' });
    });
  });
});
