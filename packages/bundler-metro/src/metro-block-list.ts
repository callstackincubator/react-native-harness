import type { MetroConfig } from 'metro-config';
import { escapeRegExp } from '@react-native-harness/tools';

type BlockList = NonNullable<MetroConfig['resolver']>['blockList'];

/**
 * Converts the canonical cache root into a cross-platform regular-expression
 * source without duplicating knowledge of the cache directory layout.
 */
const getHarnessCacheRootPatternSource = (harnessCacheRoot: string): string =>
  escapeRegExp(harnessCacheRoot).replace(/\\\\|\//g, '[/\\\\]');

/**
 * Paths harness must be able to crawl, carved out of whatever the project
 * excludes. Metro's stock `blockList` is `exclusionList()`, which reduces to
 * `__tests__` -- the directory Jest's default `testMatch` looks in -- so
 * inheriting a project's blockList verbatim would hide its tests.
 */
const HARNESS_PROTECTED_PATHS = /[/\\]__tests__[/\\]/;

/** `test()` advances `lastIndex` on global/sticky patterns, which would make
 * the crawl's ignore decisions depend on call order. Dropping `g`/`y` does not
 * change what a `test()` matches, only that it stops being stateful. */
const stripStatefulFlags = (flags: string): string =>
  flags.replace(/[gy]/g, '');

const toPatternArray = (blockList: BlockList): RegExp[] => {
  if (!blockList) {
    return [];
  }

  return Array.isArray(blockList) ? blockList.filter(Boolean) : [blockList];
};

/**
 * Rewrites `pattern` so it keeps its meaning except that it never matches a
 * protected path -- i.e. `pattern.test(p) && !protected.test(p)` as a single
 * regex, which is required because metro-file-map rebuilds whatever it is
 * given via `new RegExp(source, flags)`.
 *
 * This matters for the common `exclusionList([...])` case, where a project's
 * own exclusions and the `__tests__` rule are fused into one alternation and
 * cannot be separated by inspecting the source.
 *
 * Both sides are expressed as anchored lookarounds so they are evaluated once,
 * at position 0, rather than retried at every offset: `(?!...)` rejects any
 * path containing a protected segment, and `(?=...)` re-applies the original
 * pattern with unanchored-search semantics.
 *
 * Every group introduced here is non-capturing, and
 * `HARNESS_OWNED_EXCLUSIONS` captures nothing, so a lone project pattern keeps
 * its group numbering and its backreferences. A project passing an *array* of
 * patterns where a later one uses backreferences would still see them shift --
 * an inherent consequence of combining alternations, and one Metro's own array
 * handling shares, since it joins the sources the same way.
 */
const carveOutProtectedPaths = (source: string): string =>
  `^(?![\\s\\S]*(?:${HARNESS_PROTECTED_PATHS.source}))(?=[\\s\\S]*(?:${source}))`;

export type BlockListDrop = {
  pattern: RegExp;
  reason: 'incompatible-flags';
};

/**
 * Builds the `blockList` for a harness run: harness's own cache directory,
 * plus everything the project already excludes, minus the paths harness must
 * keep crawlable.
 *
 * Returns a single plain `RegExp`. Two constraints force that shape:
 * - metro-file-map rebuilds the pattern via `new RegExp(source, flags)`, so a
 *   subclass with an overridden `test()` would be discarded.
 * - Metro's own array handling (`createFileMap.js`) *throws* when combining
 *   patterns whose flags differ, so combining here lets us resolve flag
 *   conflicts by dropping a pattern instead of failing the run.
 */
export const getHarnessBlockList = (
  metroConfig: MetroConfig,
  harnessCacheRoot: string
): { blockList: RegExp; dropped: BlockListDrop[] } => {
  const dropped: BlockListDrop[] = [];
  const userPatterns = toPatternArray(metroConfig.resolver?.blockList);

  // A single regex carries one flag set. Adopt whichever the project's own
  // patterns agree on so e.g. a case-insensitive blockList keeps working;
  // our own pattern is flagless and unaffected either way.
  const flagCounts = new Map<string, number>();
  for (const { flags } of userPatterns) {
    const normalized = stripStatefulFlags(flags);
    flagCounts.set(normalized, (flagCounts.get(normalized) ?? 0) + 1);
  }
  const flags =
    [...flagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  const sources = [
    `^${getHarnessCacheRootPatternSource(harnessCacheRoot)}(?:[/\\\\]|$)`,
  ];
  for (const pattern of userPatterns) {
    if (stripStatefulFlags(pattern.flags) === flags) {
      sources.push(carveOutProtectedPaths(pattern.source));
    } else {
      dropped.push({ pattern, reason: 'incompatible-flags' });
    }
  }

  return {
    blockList: new RegExp(
      sources.map((source) => `(?:${source})`).join('|'),
      flags
    ),
    dropped,
  };
};
