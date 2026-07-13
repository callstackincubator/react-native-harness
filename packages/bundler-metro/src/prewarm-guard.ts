const PARAM_DEFAULTS: Record<string, string> = {
  dev: 'true',
  minify: 'false',
  lazy: 'false',
  shallow: 'false',
  unstable_transformProfile: 'default',
};

const isTransformOrResolverParam = (key: string): boolean =>
  key.startsWith('transform.') || key.startsWith('resolver.');

/**
 * Compares two bundle request URLs on Metro's graph-key dimensions only
 * (entryFile/pathname, platform, dev, minify, lazy, shallow,
 * unstable_transformProfile, and every transform.* / resolver.* param).
 * Everything else (app, hot, runModule, modulesOnly, inlineSourceMap,
 * excludeSource, sourcePaths, sourceMapUrl, ...) is serializer-only and
 * ignored. Returns a list of human-readable descriptions of the mismatched
 * keys, or an empty array when the requests would resolve to the same
 * Metro dependency graph. Never throws -- malformed URLs are treated as
 * "no diff" so this can never crash the caller.
 */
export const diffGraphRelevantParams = (
  prewarmUrl: string,
  appUrl: string
): string[] => {
  try {
    const prewarm = new URL(prewarmUrl, 'http://localhost');
    const app = new URL(appUrl, 'http://localhost');
    const diffs: string[] = [];

    const prewarmPathname = decodeURIComponent(prewarm.pathname);
    const appPathname = decodeURIComponent(app.pathname);

    if (prewarmPathname !== appPathname) {
      diffs.push(`pathname (prewarm=${prewarmPathname}, app=${appPathname})`);
    }

    const compareParam = (key: string, defaultValue = '') => {
      const prewarmValue = prewarm.searchParams.get(key) ?? defaultValue;
      const appValue = app.searchParams.get(key) ?? defaultValue;

      if (prewarmValue !== appValue) {
        diffs.push(`${key} (prewarm=${prewarmValue}, app=${appValue})`);
      }
    };

    compareParam('platform');
    compareParam('dev', PARAM_DEFAULTS.dev);
    compareParam('minify', PARAM_DEFAULTS.minify);
    compareParam('lazy', PARAM_DEFAULTS.lazy);
    compareParam('shallow', PARAM_DEFAULTS.shallow);
    compareParam(
      'unstable_transformProfile',
      PARAM_DEFAULTS.unstable_transformProfile
    );

    const transformResolverKeys = new Set<string>();

    for (const key of prewarm.searchParams.keys()) {
      if (isTransformOrResolverParam(key)) {
        transformResolverKeys.add(key);
      }
    }

    for (const key of app.searchParams.keys()) {
      if (isTransformOrResolverParam(key)) {
        transformResolverKeys.add(key);
      }
    }

    for (const key of transformResolverKeys) {
      compareParam(key);
    }

    return diffs;
  } catch {
    return [];
  }
};
