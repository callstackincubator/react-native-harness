/**
 * Build/output directories that are never resolved as modules and should
 * never be crawled by Metro's file map. These contribute a large number of
 * files (native build intermediates, Gradle caches, DerivedData) that only
 * inflate the in-memory file map without ever being requested.
 *
 * Each pattern is anchored so it only matches a full path *segment* -- i.e.
 * the matched directory name must be bounded by a path separator (or the
 * start/end of the string) on both sides. This is what prevents:
 *   - `packages/my-lib/src/ios/build-utils/index.ts` (a "build-utils" dir,
 *     not "build") from matching the `ios/build` pattern
 *   - `packages/build/src/index.ts` (a package literally named "build")
 *     from matching, since it has no `ios/` or `android/` prefix segment
 *   - a hypothetical `not-android/build` from matching `android/build`,
 *     since the character preceding `android` must be a separator or
 *     start-of-string, not part of a longer segment name
 *
 * `[\\/]` matches either a POSIX or Windows path separator, since Metro may
 * be invoked on either platform. Literal dots in `.gradle` / `.harness` are
 * escaped so they don't accidentally match "any character".
 */
export const HARNESS_METRO_BLOCK_LIST_PATTERNS: readonly RegExp[] = [
  // iOS build output, e.g. `<project>/ios/build/...`
  /(^|[\\/])ios[\\/]build(?:[\\/]|$)/,
  // Android build output, e.g. `<project>/android/build/...` or a
  // per-module `<project>/android/app/build/...`
  /(^|[\\/])android[\\/]build(?:[\\/]|$)/,
  // Gradle's local cache/state directory, e.g. `<project>/android/.gradle/...`
  /(^|[\\/])android[\\/]\.gradle(?:[\\/]|$)/,
  // Xcode's DerivedData, wherever it happens to live (it may be relocated
  // via user Xcode preferences, so this intentionally has no prefix).
  /(^|[\\/])DerivedData(?:[\\/]|$)/,
  // The harness's own on-disk cache.
  /(^|[\\/])\.harness[\\/]cache(?:[\\/]|$)/,
];

const toRegExpArray = (
  blockList: RegExp | RegExp[] | undefined,
): RegExp[] => {
  if (blockList === undefined) {
    return [];
  }

  return Array.isArray(blockList) ? blockList : [blockList];
};

// A canary path used to detect and drop any inherited pattern that would
// block harness test modules. Metro's own `getDefaultConfig()` sets
// `resolver.blockList` to an `exclusionList()` that matches anything under a
// `__tests__` directory (`/\/__tests__\/.*/`) -- by the time `withRnHarness`
// sees `metroConfig`, `Metro.loadConfig()` has already applied that default,
// so it is indistinguishable here from a pattern a user added on purpose.
// Harness tests live under `__tests__` (e.g. `src/__tests__/...`), so Metro
// must always be able to resolve them; keeping a pattern that would block
// this canary would silently break every harness test suite, so any such
// pattern is dropped rather than merged in.
const HARNESS_TEST_DIRECTORY_CANARY_PATH = '/project/src/__tests__/smoke.ts';

const blocksHarnessTests = (pattern: RegExp): boolean =>
  pattern.test(HARNESS_TEST_DIRECTORY_CANARY_PATH);

/**
 * Merges the harness's own build-output block patterns into a resolver's
 * existing `blockList`, which may be `undefined`, a single `RegExp`, or a
 * `RegExp[]` (Metro accepts either shape, and so may the user's config or
 * `@react-native/metro-config`). Existing patterns are preserved, except any
 * that would block the `__tests__` directories harness tests live in (see
 * `blocksHarnessTests` above) -- those are dropped rather than merged in.
 */
export const mergeHarnessBlockList = (
  existingBlockList: RegExp | RegExp[] | undefined,
): RegExp[] => [
  ...toRegExpArray(existingBlockList).filter(
    (pattern) => !blocksHarnessTests(pattern),
  ),
  ...HARNESS_METRO_BLOCK_LIST_PATTERNS,
];
