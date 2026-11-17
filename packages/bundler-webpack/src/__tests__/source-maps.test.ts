import { describe, expect, it, vi } from 'vitest';
import { createSourceMapProvider, toAssetNames } from '../source-maps.js';

const MAP = JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' });

describe('toAssetNames', () => {
  it('names the file under the output folder', () => {
    expect(toAssetNames('http://localhost:8081/chunks/a.js', 'auto')).toEqual(['chunks/a.js']);
  });

  it('tries the name without publicPath first', () => {
    expect(toAssetNames('http://localhost:8081/static/a.js', '/static/')).toEqual(['a.js', 'static/a.js']);
    expect(toAssetNames('http://localhost:8081/a.js', '/static/')).toEqual(['a.js']);
  });

  it('finds nothing in what is not a URL', () => {
    expect(toAssetNames('not a url', '')).toEqual([]);
  });
});

describe('createSourceMapProvider', () => {
  const snapshot = {
    hash: 'h',
    publicPath: 'auto',
    scripts: [],
    styles: [],
    sourceMaps: new Map([
      ['a.js', 'maps/a.js.map'],
      ['bad.js', 'bad.js.map'],
    ]),
  };
  const setup = (files: Record<string, string>) => {
    const readAsset = vi.fn(async (name: string) => files[name] ?? null);

    return {
      readAsset,
      provider: createSourceMapProvider({ getSnapshot: () => snapshot, readAsset }),
    };
  };

  it('reads the map the stats name, once', async () => {
    const { provider, readAsset } = setup({ 'maps/a.js.map': MAP });

    expect(await provider.getSourceMap('http://localhost:8081/a.js')).not.toBeNull();
    expect(await provider.getSourceMap('http://localhost:8081/a.js')).not.toBeNull();
    expect(readAsset).toHaveBeenCalledTimes(1);
    expect(readAsset).toHaveBeenCalledWith('maps/a.js.map');
  });

  it('forgets maps when the next compilation replaces them', async () => {
    const { provider, readAsset } = setup({ 'maps/a.js.map': MAP });

    await provider.getSourceMap('http://localhost:8081/a.js');
    provider.reset();
    await provider.getSourceMap('http://localhost:8081/a.js');

    expect(readAsset).toHaveBeenCalledTimes(2);
  });

  it('answers null for a script the stats give no map, or a broken one', async () => {
    const { provider } = setup({ 'bad.js.map': '{nope' });

    expect(await provider.getSourceMap('http://localhost:8081/none.js')).toBeNull();
    expect(await provider.getSourceMap('http://localhost:8081/bad.js')).toBeNull();
  });
});
