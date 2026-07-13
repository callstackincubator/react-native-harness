import { createRequire } from 'node:module';
import type { MetroConfig } from 'metro-config';
import type {
  ReadOnlyGraph,
  Module,
} from 'metro/private/DeltaBundler/types';
import { logger } from '@react-native-harness/tools';

const require = createRequire(import.meta.url);
const serializerLogger = logger.child('metro-serializer');

export type Serializer = NonNullable<
  NonNullable<MetroConfig['serializer']>['customSerializer']
>;

type PreModule = Parameters<Serializer>[1][number];
type Graph = ReadOnlyGraph;
type BundleOptions = Parameters<Serializer>[3];

// Both of these are CJS modules compiled with `exports.default = ...`
// (Babel/Flow's ESM-interop output), not modules that assign their export
// directly to `module.exports`. A plain `require()` therefore returns
// `{default: fn}`, not `fn` itself -- unwrap `.default` explicitly rather
// than calling the require() result as a function.
const baseJSBundle: (
  entryPoint: string,
  preModules: ReadonlyArray<PreModule>,
  graph: Graph,
  options: BundleOptions
) => {
  pre: string;
  post: string;
  modules: Array<[number, string]>;
} = require('metro/private/DeltaBundler/Serializers/baseJSBundle').default;

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
).default;

const asSerializerResult = (result: {
  code: string;
  metadata: unknown;
}): Awaited<ReturnType<Serializer>> =>
  result as unknown as Awaited<ReturnType<Serializer>>;

// Same filter Metro's own `processModules` helper (used internally by
// baseJSBundle) applies before a module gets wrapped into a `__d()` call.
const isJsModule: (mod: Module) => boolean = require(
  'metro/private/DeltaBundler/Serializers/helpers/js'
).isJsModule;

const countLines = (code: string): number =>
  (code.match(/\n/g)?.length ?? 0) + 1;

/**
 * Replaces a skipped module's code with blank lines instead of omitting it.
 *
 * Metro's `.map` endpoint and `/symbolicate` (Server.js's
 * `_processSourceMapRequest` / `_explodedSourceMapForBundleOptions`) compute
 * line offsets from the full, unfiltered graph -- they only ever see the
 * config-level `processModuleFilter`, never a custom serializer's per-call
 * override. If we simply left already-included modules out of the test
 * bundle, every module's line offset after the first omitted one would
 * shift, producing wrong code frames for test failures. Blanking preserves
 * the exact line count instead, so an unfiltered `.map`/`/symbolicate`
 * response is still correct for the (blanked) bundle we actually send.
 */
const blankModuleCode = (code: string): string => {
  const newlineCount = countLines(code) - 1;
  const blank = '\n'.repeat(newlineCount);

  // bundleToString (metro/private/lib/bundleToString.js) skips appending a
  // module's code entirely -- not even a trailing newline -- when its
  // length is 0. The original module code is never empty, so a blank of ''
  // (i.e. a module with no internal newlines) would drop the one line that
  // module used to occupy and desync every subsequent module's offset. A
  // single space keeps the length > 0 without adding an extra line.
  return blank.length > 0 ? blank : ' ';
};

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
 * change which module PATHS end up in the graph: platform, dev, and minify.
 *
 * Platform keying is load-bearing: `.ios.ts` and `.android.ts` resolve to
 * different paths, so an iOS capture must never be used to blank an Android
 * test bundle (or vice versa). dev/minify are kept for the same "different
 * request class" hygiene.
 *
 * `unstable_transformProfile` and `customTransformOptions` are deliberately
 * EXCLUDED, for two reasons:
 *
 * (a) Including them makes the two sides of the lookup permanently
 *     mismatched on Expo: the Expo client's main-bundle request carries
 *     `transform.engine=hermes`, `transform.bytecode=1`,
 *     `transform.routerRoot=app`, `transform.reactCompiler=true`, and
 *     `unstable_transformProfile=hermes-stable` (see `bundle-url.ts`),
 *     while the harness runtime's `?modulesOnly=true` test-bundle requests
 *     send only `modulesOnly` + `platform` (packages/runtime/src/bundler/
 *     bundle.ts), so its graph gets default/empty transform options. The
 *     modulesOnly lookup would then always miss, fail open, and silently
 *     turn the feature into a no-op forever.
 *
 * (b) Excluding them is still crash-safe. Blanking a path only requires
 *     that the device already holds *a* `__d()` definition for that path's
 *     module ID -- and module IDs are path-based via Metro's single
 *     server-wide `createModuleId` counter, while exclusion only ever
 *     applies to paths captured from a main bundle actually served to the
 *     device. Transform options change a module's *content*, not the
 *     presence of its definition, so a profile/custom-options difference
 *     between the two graphs cannot produce "Requiring unknown module".
 */
const getGraphKey = (graph: Graph): string => {
  const { platform, dev, minify } = graph.transformOptions;

  return JSON.stringify({
    platform: platform ?? null,
    dev,
    minify,
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
 * Builds the set of module paths already shipped (as a `__d()` definition)
 * in the main bundle.
 *
 * Deliberately does NOT use Metro's `getAllFiles` serializer helper: for
 * asset modules that helper expands to the physical variant files on disk
 * (e.g. `icon@2x.png`) rather than the module path Metro actually uses to
 * identify the module in the graph (`mod.path`), so assets would never
 * match and the helper does pointless async fs work besides. Building the
 * set directly from `preModules` and `graph.dependencies` gives us exactly
 * the identifiers `processModuleFilter`/`createModuleId` operate on.
 *
 * Mirrors the exact filter Metro's `processModules` helper applies
 * (`isJsModule` + the user's own config-level `processModuleFilter`) before
 * a module is wrapped into the main bundle. A module the user's filter
 * rejects from the main bundle can still be a real dependency of a test
 * file (it simply never reached the device the first time), so it must
 * NOT be recorded as "already included" -- doing so would make the
 * modulesOnly branch blank out a module the device never actually got,
 * which is the over-exclusion crash this feature must never cause.
 */
const collectIncludedModulePaths = (
  preModules: ReadonlyArray<PreModule>,
  graph: Graph,
  processModuleFilter: BundleOptions['processModuleFilter']
): Set<string> => {
  const paths = new Set<string>();
  const isIncludedInMainBundle = (mod: Module): boolean =>
    isJsModule(mod) && (!processModuleFilter || processModuleFilter(mod));

  for (const preModule of preModules) {
    if (isIncludedInMainBundle(preModule)) {
      paths.add(preModule.path);
    }
  }

  for (const mod of graph.dependencies.values()) {
    if (isIncludedInMainBundle(mod)) {
      paths.add(mod.path);
    }
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
        // Capture assumption: we read `preModules`/`graph.dependencies`
        // even when serialization below is delegated to the user's
        // customSerializer (e.g. Expo's). If that serializer dropped
        // modules beyond the config-level processModuleFilter (as some do
        // for production tree-shaking), this set could over-include and
        // blank a module the device never received. That's fine in
        // practice: the harness always serves dev-mode bundles, and
        // dev-mode serving doesn't tree-shake -- but it is the boundary of
        // what this capture can guarantee.
        const graphKey = getGraphKey(graph);
        const capturedModules = collectIncludedModulePaths(
          preModules,
          graph,
          bundleOptions.processModuleFilter
        );
        includedModulesByGraphKey.set(graphKey, capturedModules);
        serializerLogger.debug(
          'captured %d main-bundle module paths for graph key %s',
          capturedModules.size,
          graphKey
        );
      }

      const serialize = customSerializer ?? defaultSerializer;
      return serialize(entryPoint, preModules, graph, bundleOptions);
    }

    const graphKey = getGraphKey(graph);
    const includedModules = includedModulesByGraphKey.get(graphKey);

    if (!includedModules || includedModules.size === 0) {
      // Fail open: we have never observed a main bundle for this exact
      // graph identity, so we don't know what the device already has.
      // Serialize normally rather than risk stripping a module it never
      // received. The debug log below is the diagnostic breadcrumb for
      // "why are my test bundles fat".
      serializerLogger.debug(
        'no captured main-bundle module set for graph key %s (held keys: %s); serving the test bundle unfiltered',
        graphKey,
        [...includedModulesByGraphKey.keys()].join(', ') || '<none>'
      );
      return defaultSerializer(entryPoint, preModules, graph, bundleOptions);
    }

    // Serialize the FULL graph -- options.processModuleFilter is passed
    // through untouched, with no per-call override -- so Metro's
    // independent `.map`/`/symbolicate` code paths (which only ever see
    // that config-level filter) compute line offsets that match what we
    // actually send byte-for-byte. Already-included modules are blanked out
    // afterwards instead of omitted; see `blankModuleCode`.
    const bundle = baseJSBundle(entryPoint, preModules, graph, bundleOptions);

    const excludedModuleIds = new Set<number>();
    for (const path of includedModules) {
      excludedModuleIds.add(bundleOptions.createModuleId(path));
    }

    const blankedModules: Array<[number, string]> = bundle.modules.map(
      ([id, code]) =>
        excludedModuleIds.has(id) ? [id, blankModuleCode(code)] : [id, code]
    );

    return asSerializerResult(
      bundleToString({ ...bundle, modules: blankedModules })
    );
  };
};
