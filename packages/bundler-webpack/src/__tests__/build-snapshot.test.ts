import { describe, expect, it } from 'vitest';
import { createBuildSnapshot } from '../build-snapshot.js';
import type { CompilerStats, StatsJson } from '../types.js';

const stats = (json: StatsJson, hash = 'h'): CompilerStats => ({
  hash,
  hasErrors: () => false,
  toString: () => '',
  toJson: () => json,
});

describe('createBuildSnapshot', () => {
  it('lists the files of every entrypoint in order, once, under publicPath', () => {
    const snapshot = createBuildSnapshot(
      stats({
        publicPath: '/static/',
        entrypoints: {
          main: { assets: [{ name: 'runtime.js' }, { name: 'vendors.js' }, { name: 'main.css' }, { name: 'main.js' }] },
          admin: { assets: [{ name: 'runtime.js' }, { name: 'vendors.js' }, { name: 'admin.js' }] },
        },
      }),
      null
    );

    expect(snapshot.scripts).toEqual([
      '/static/runtime.js',
      '/static/vendors.js',
      '/static/main.js',
      '/static/admin.js',
    ]);
    expect(snapshot.styles).toEqual(['/static/main.css']);
    expect(snapshot.hash).toBe('h');
  });

  it.each([undefined, '', 'auto'])('serves from the root when publicPath is %j', (publicPath) => {
    expect(
      createBuildSnapshot(
        stats({ publicPath, entrypoints: { main: { assets: [{ name: 'main.js' }] } } }),
        null
      ).scripts
    ).toEqual(['/main.js']);
  });

  it('keeps a publicPath that is a full URL', () => {
    expect(
      createBuildSnapshot(
        stats({
          publicPath: 'http://localhost:8081/assets/',
          entrypoints: { main: { assets: [{ name: 'main.js' }] } },
        }),
        null
      ).scripts
    ).toEqual(['http://localhost:8081/assets/main.js']);
  });

  it('takes each map from the stats, whatever it is called and wherever it is', () => {
    const snapshot = createBuildSnapshot(
      stats({
        assets: [
          { name: 'a.js', info: { related: { sourceMap: 'maps/a.js.map' } } },
          { name: 'b.js', info: { related: { sourceMap: ['b.js.map'] } } },
          { name: 'c.js', info: {} },
          {},
        ],
      }),
      null
    );

    expect([...snapshot.sourceMaps]).toEqual([
      ['a.js', 'maps/a.js.map'],
      ['b.js', 'b.js.map'],
    ]);
  });

  it('keeps the maps of the build before when a build lists no assets', () => {
    const first = createBuildSnapshot(
      stats({ assets: [{ name: 'a.js', info: { related: { sourceMap: 'a.js.map' } } }] }),
      null
    );

    expect(createBuildSnapshot(stats({ assets: [{}] }, 'h2'), first).sourceMaps).toBe(first.sourceMaps);
  });
});
