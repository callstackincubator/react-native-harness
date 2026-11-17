import { TraceMap } from '@jridgewell/trace-mapping';
import type { BuildSnapshot } from './build-snapshot.js';

export type SourceMapProvider = {
  /** The map of the script the browser loaded from `url`, or null when the build has none. */
  getSourceMap: (url: string) => Promise<TraceMap | null>;
  /** Forgets the maps read so far. The next compilation replaces them. */
  reset: () => void;
};

/**
 * Where the asset a URL asks for is in the build output. A script is served
 * from `publicPath` and written to the output folder without it.
 */
export const toAssetNames = (url: string, publicPath: string): string[] => {
  let pathname: string;

  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return [];
  }

  const names = [pathname.replace(/^\/+/, '')];

  if (publicPath && publicPath !== 'auto') {
    let prefix: string;

    try {
      prefix = new URL(publicPath, 'http://localhost').pathname;
    } catch {
      return names;
    }

    if (prefix !== '/' && pathname.startsWith(prefix)) {
      names.unshift(pathname.slice(prefix.length).replace(/^\/+/, ''));
    }
  }

  return names;
};

/**
 * Reads the source map of a script from the build output, under the name the
 * stats give it (`output.sourceMapFilename` can put it anywhere), and parses
 * it once.
 */
export const createSourceMapProvider = ({
  getSnapshot,
  readAsset,
}: {
  getSnapshot: () => BuildSnapshot | null;
  /** The text of an output file, or null when there is none. */
  readAsset: (name: string) => Promise<string | null>;
}): SourceMapProvider => {
  const maps = new Map<string, Promise<TraceMap | null>>();

  const load = async (mapName: string): Promise<TraceMap | null> => {
    const text = await readAsset(mapName);

    if (text === null) {
      return null;
    }

    try {
      return new TraceMap(text);
    } catch {
      return null;
    }
  };

  return {
    getSourceMap: async (url) => {
      const snapshot = getSnapshot();

      if (!snapshot) {
        return null;
      }

      for (const name of toAssetNames(url, snapshot.publicPath)) {
        const mapName = snapshot.sourceMaps.get(name);

        if (mapName) {
          let map = maps.get(mapName);

          if (!map) {
            map = load(mapName);
            maps.set(mapName, map);
          }

          return map;
        }
      }

      return null;
    },
    reset: () => maps.clear(),
  };
};
