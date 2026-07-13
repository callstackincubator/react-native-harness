import { createRequire } from 'node:module';
import type { MetroConfig } from 'metro-config';
import type {
  ReadOnlyGraph,
  Module,
} from 'metro/private/DeltaBundler/types';

const require = createRequire(import.meta.url);

export type Serializer = NonNullable<
  NonNullable<MetroConfig['serializer']>['customSerializer']
>;

type PreModule = Parameters<Serializer>[1][number];
type Graph = ReadOnlyGraph;
type BundleOptions = Parameters<Serializer>[3];

const baseJSBundle: (
  entryPoint: string,
  preModules: ReadonlyArray<PreModule>,
  graph: Graph,
  options: BundleOptions
) => {
  pre: string;
  post: string;
  modules: Array<[number, string]>;
} = require('metro/private/DeltaBundler/Serializers/baseJSBundle');

// Metro ships no .d.ts for this module. Its actual (synchronous) return shape
// is `{code, metadata}`, which doesn't line up with the `customSerializer`
// type's `{code, map}` -- but Metro's Server only reads `.code` off of
// whatever a custom serializer returns and computes `.map` itself when it's
// absent (see Server.js's `_serializeGraph`), so the mismatch is harmless in
// practice. `asSerializerResult` documents/contains that cast.
const bundleToString: (bundle: {
  pre: string;
  post: string;
  modules: Array<[number, string]>;
}) => { code: string; metadata: unknown } = require(
  'metro/private/lib/bundleToString'
);

const asSerializerResult = (result: {
  code: string;
  metadata: unknown;
}): Awaited<ReturnType<Serializer>> =>
  result as unknown as Awaited<ReturnType<Serializer>>;

export type GetHarnessSerializerOptions = {
  /**
   * Absolute path Metro resolves the harness main entry point to (the
   * runtime's `entry-point` module -- see
   * `resolvers/resolver.ts#createHarnessEntryPointResolver`). Both the app's
   * configured `entryPoint` and Expo's virtual entry
   * (`.expo/.virtual-metro-entry`) resolve to this exact same absolute path,
   * so matching against it also transparently covers the Expo case.
   */
  harnessEntryPointPath: string;
  /**
   * The consuming project's own `serializer.customSerializer`, if any (e.g.
   * Expo's). Used for every non-modulesOnly (main bundle) serialization so
   * this feature stays non-invasive -- capturing the already-included module
   * set is a read-only side effect that never changes what gets served.
   */
  customSerializer?: Serializer;
};

/**
 * Derives a stable key from the parts of `graph.transformOptions` that
 * change what ends up in the graph (platform, dev/prod, minify,
 * transform profile, and any custom transform options). Module sets differ
 * across these -- e.g. a `.ios.ts` file's dependencies are not the same set
 * as `.android.ts` -- so the captured "already included" set must never be
 * shared across them.
 */
const getGraphKey = (graph: Graph): string => {
  const {
    platform,
    dev,
    minify,
    unstable_transformProfile,
    customTransformOptions,
  } = graph.transformOptions;

  return JSON.stringify({
    platform: platform ?? null,
    dev,
    minify,
    unstable_transformProfile,
    customTransformOptions: customTransformOptions ?? {},
  });
};

const isMainEntrySerialization = (
  entryPoint: string,
  graph: Graph,
  harnessEntryPointPath: string
): boolean =>
  entryPoint === harnessEntryPointPath ||
  graph.entryPoints.has(harnessEntryPointPath);

/**
 * Builds the set of module paths already shipped in the main bundle.
 *
 * Deliberately does NOT use Metro's `getAllFiles` serializer helper: for
 * asset modules that helper expands to the physical variant files on disk
 * (e.g. `icon@2x.png`) rather than the module path Metro actually uses to
 * identify the module in the graph (`mod.path`), so assets would never
 * match and the helper does pointless async fs work besides. Building the
 * set directly from `preModules` and `graph.dependencies` keys gives us
 * exactly the identifiers `processModuleFilter`/`createModuleId` operate on.
 */
const collectIncludedModulePaths = (
  preModules: ReadonlyArray<PreModule>,
  graph: Graph
): Set<string> => {
  const paths = new Set<string>();

  for (const preModule of preModules) {
    paths.add(preModule.path);
  }

  for (const path of graph.dependencies.keys()) {
    paths.add(path);
  }

  return paths;
};

/**
 * Serializer that skips re-sending modules already served in the harness
 * main bundle when Metro serves a `?modulesOnly=true` per-test-file bundle.
 *
 * Failure-direction rule: under-exclusion (a fatter test bundle) is always
 * safe; over-exclusion crashes the device with "Requiring unknown module".
 * Every branch below is written to fail open toward inclusion whenever the
 * main-bundle module set for a given graph is unknown or ambiguous.
 */
export const getHarnessSerializer = (
  options: GetHarnessSerializerOptions
): Serializer => {
  const { harnessEntryPointPath, customSerializer } = options;

  const defaultSerializer: Serializer = async (
    entryPoint,
    preModules,
    graph,
    bundleOptions
  ) =>
    asSerializerResult(
      bundleToString(baseJSBundle(entryPoint, preModules, graph, bundleOptions))
    );

  // One set of "already included" module paths per graph identity (see
  // `getGraphKey`). Only ever written from a positively-identified main
  // bundle serialization (see below), so a debugger or browser hitting an
  // arbitrary bundle URL, or another entry point entirely, can never
  // clobber it.
  const includedModulesByGraphKey = new Map<string, Set<string>>();

  return async (entryPoint, preModules, graph, bundleOptions) => {
    if (!bundleOptions.modulesOnly) {
      if (isMainEntrySerialization(entryPoint, graph, harnessEntryPointPath)) {
        includedModulesByGraphKey.set(
          getGraphKey(graph),
          collectIncludedModulePaths(preModules, graph)
        );
      }

      const serialize = customSerializer ?? defaultSerializer;
      return serialize(entryPoint, preModules, graph, bundleOptions);
    }

    const includedModules = includedModulesByGraphKey.get(getGraphKey(graph));

    if (!includedModules || includedModules.size === 0) {
      // Fail open: we have never observed a main bundle for this exact
      // graph identity, so we don't know what the device already has.
      // Serialize normally rather than risk stripping a module it never
      // received.
      return defaultSerializer(entryPoint, preModules, graph, bundleOptions);
    }

    // Phase 2 replaces this filter-based exclusion with post-hoc blanking
    // of module code so source maps and `/symbolicate` (which only see
    // Metro's config-level `processModuleFilter`, not this per-call
    // override) stay in sync with what's actually sent to the device.
    return defaultSerializer(entryPoint, preModules, graph, {
      ...bundleOptions,
      processModuleFilter: (mod: Module) => {
        if (
          bundleOptions.processModuleFilter &&
          !bundleOptions.processModuleFilter(mod)
        ) {
          return false;
        }

        return !includedModules.has(mod.path);
      },
    });
  };
};
