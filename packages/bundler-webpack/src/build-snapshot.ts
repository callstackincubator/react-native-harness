import type { CompilerStats } from './types.js';

/** What the server needs to know about one finished build. */
export type BuildSnapshot = {
  hash: string | null;
  /** The `output.publicPath` the build was made with. */
  publicPath: string;
  /** URLs of the scripts the entrypoints load, in the order to load them, each once. */
  scripts: string[];
  styles: string[];
  /** The source map asset of each asset, by name. */
  sourceMaps: ReadonlyMap<string, string>;
};

const SCRIPT = /\.[cm]?js$/;
const STYLE = /\.css$/;

// `auto` and an empty path both mean "next to the page", which is the root
// of this server.
const toPrefix = (publicPath: string): string =>
  !publicPath || publicPath === 'auto' ? '/' : publicPath;

const unique = (names: string[]): string[] => [...new Set(names)];

/**
 * Reads the stats of a finished build once. A build that changed nothing
 * lists no assets, so the source maps of the one before stay.
 */
export const createBuildSnapshot = (
  stats: CompilerStats,
  previous: BuildSnapshot | null
): BuildSnapshot => {
  const json = stats.toJson({
    all: false,
    assets: true,
    entrypoints: true,
    publicPath: true,
  });
  const publicPath = json.publicPath ?? '';
  const prefix = toPrefix(publicPath);
  // Every entrypoint's files, as html-webpack-plugin lists them.
  const files = unique(
    Object.values(json.entrypoints ?? {}).flatMap(({ assets }) =>
      (assets ?? []).map(({ name }) => name)
    )
  );
  const sourceMaps = new Map<string, string>();

  for (const { name, info } of json.assets ?? []) {
    const related = info?.related?.sourceMap;
    const map = Array.isArray(related) ? related[0] : related;

    if (name && map) {
      sourceMaps.set(name, map);
    }
  }

  return {
    hash: stats.hash ?? null,
    publicPath,
    scripts: files.filter((name) => SCRIPT.test(name)).map((name) => prefix + name),
    styles: files.filter((name) => STYLE.test(name)).map((name) => prefix + name),
    sourceMaps:
      sourceMaps.size === 0 && previous ? previous.sourceMaps : sourceMaps,
  };
};
