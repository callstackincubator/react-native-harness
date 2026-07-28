import { describe, expect, it } from 'vitest';
import {
  HARNESS_METRO_BLOCK_LIST_PATTERNS,
  mergeHarnessBlockList,
} from '../metro-block-list.js';

const combined = new RegExp(
  HARNESS_METRO_BLOCK_LIST_PATTERNS.map((pattern) => pattern.source).join(
    '|',
  ),
);

describe('HARNESS_METRO_BLOCK_LIST_PATTERNS', () => {
  it.each([
    '/repo/apps/playground/ios/build/Build/Products/Debug.app',
    '/repo/apps/playground/ios/build',
    '/repo/apps/playground/android/build/outputs/apk/debug/app-debug.apk',
    '/repo/apps/playground/android/build',
    '/repo/apps/playground/android/.gradle/caches/foo.lock',
    '/repo/apps/playground/android/.gradle',
    '/Users/dev/Library/Developer/Xcode/DerivedData/App-abcdef/Build/Products/x.app',
    '/Users/dev/Library/Developer/Xcode/DerivedData',
    '/repo/apps/playground/.harness/cache/metro/foo.bin',
    '/repo/apps/playground/.harness/cache',
    // Windows-style separators.
    'C:\\repo\\apps\\playground\\ios\\build\\Build\\x.app',
    'C:\\repo\\apps\\playground\\android\\.gradle\\caches',
  ])('matches build/output path %s', (path) => {
    expect(combined.test(path)).toBe(true);
  });

  it.each([
    // A source directory named "build-utils" under ios/, not the "build" output dir.
    '/repo/packages/my-lib/src/ios/build-utils/index.ts',
    // A package literally named "build", with no ios/android prefix segment.
    '/repo/packages/build/src/index.ts',
    // "android" as a substring of a longer, unrelated segment name.
    '/repo/apps/not-android/build/index.ts',
    // "build" as a substring of a longer, unrelated segment name.
    '/repo/apps/playground/android/build-tools/index.ts',
    '/repo/apps/playground/ios/build-scripts/index.ts',
    // ".gradle" as a prefix of a longer, unrelated segment name.
    '/repo/apps/playground/android/.gradle-wrapper/index.ts',
    // "DerivedData" as a prefix of a longer, unrelated segment name.
    '/repo/apps/playground/DerivedDataExporter/index.ts',
    // ".harness/cache" as a prefix of a longer, unrelated segment name.
    '/repo/apps/playground/.harness/cache-utils/index.ts',
    // A totally unrelated app source file.
    '/repo/apps/playground/src/components/Button.tsx',
  ])('does not match plausible source path %s', (path) => {
    expect(combined.test(path)).toBe(false);
  });
});

describe('mergeHarnessBlockList', () => {
  it('returns just the harness patterns when there is no existing blockList', () => {
    const merged = mergeHarnessBlockList(undefined);

    expect(merged).toEqual(HARNESS_METRO_BLOCK_LIST_PATTERNS);
  });

  it('preserves a single existing RegExp and appends the harness patterns', () => {
    const userPattern = /\/fixtures\/.*/;

    const merged = mergeHarnessBlockList(userPattern);

    expect(merged).toEqual([userPattern, ...HARNESS_METRO_BLOCK_LIST_PATTERNS]);
  });

  it('preserves an existing RegExp[] and appends the harness patterns', () => {
    const userPatterns = [/\/fixtures\/.*/, /\/coverage\/.*/];

    const merged = mergeHarnessBlockList(userPatterns);

    expect(merged).toEqual([
      ...userPatterns,
      ...HARNESS_METRO_BLOCK_LIST_PATTERNS,
    ]);
  });

  it('drops an inherited pattern that would block harness __tests__ directories', () => {
    // This is Metro's own default `resolver.blockList`, set by
    // `getDefaultConfig()` via `exclusionList()`. If it survived the merge,
    // Metro would refuse to resolve any harness test file.
    const metroDefaultExclusionList = /\/__tests__\/.*/;

    const merged = mergeHarnessBlockList(metroDefaultExclusionList);

    expect(merged).toEqual(HARNESS_METRO_BLOCK_LIST_PATTERNS);

    const combinedMerged = new RegExp(
      merged.map((pattern) => pattern.source).join('|'),
    );
    expect(
      combinedMerged.test(
        '/repo/apps/playground/src/__tests__/normal/smoke.harness.ts',
      ),
    ).toBe(false);
  });

  it('keeps other patterns in an array while dropping only the __tests__-blocking one', () => {
    const userPatterns = [/\/fixtures\/.*/, /\/__tests__\/.*/];

    const merged = mergeHarnessBlockList(userPatterns);

    expect(merged).toEqual([
      /\/fixtures\/.*/,
      ...HARNESS_METRO_BLOCK_LIST_PATTERNS,
    ]);
  });
});
