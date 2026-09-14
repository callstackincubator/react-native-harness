import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { MetroConfig } from 'metro-config';
import { getHarnessBlockList } from '../metro-block-list.js';
import { getHarnessManifestPath } from '../paths.js';

// `exclusionList` is what produces Metro's stock `resolver.blockList`, but it
// is not reachable through metro-config's `exports` map -- load it by path so
// these tests assert against Metro's real output rather than a copy of it.
const require = createRequire(import.meta.url);
const exclusionList = require(
  path.join(
    path.dirname(require.resolve('metro-config/package.json')),
    'src/defaults/exclusionList.js'
  )
).default as (extras?: (RegExp | string)[]) => RegExp;

const withBlockList = (
  blockList: NonNullable<MetroConfig['resolver']>['blockList']
): MetroConfig => ({ resolver: { blockList } }) as MetroConfig;

const HARNESS_CACHE_ROOT = '/p/.harness/cache';

// Metro's `exclusionList` rewrites `/` in its patterns to `path.sep`, so a
// blockList inherited from it only matches paths in the host OS's separator.
// The harness's own patterns match either separator; these need the switch.
const sys = (posixPath: string) => posixPath.split('/').join(path.sep);

const getBlockList = (
  blockList: NonNullable<MetroConfig['resolver']>['blockList']
) => getHarnessBlockList(withBlockList(blockList), HARNESS_CACHE_ROOT);

describe('getHarnessBlockList', () => {
  describe('harness-owned exclusions', () => {
    it('excludes the cache harness creates under .harness', () => {
      const { blockList } = getBlockList(undefined);

      expect(blockList.test('/p/.harness/cache/metro/ab/cdef')).toBe(true);
      expect(blockList.test('/p/.harness/cache/metro-file-map/map.v1')).toBe(
        true
      );
      expect(blockList.test('\\p\\.harness\\cache\\metro\\ab\\cdef')).toBe(
        true
      );
    });

    it('only excludes the canonical cache root', () => {
      const { blockList } = getBlockList(undefined);

      expect(blockList.test('/other/.harness/cache/metro/ab/cdef')).toBe(false);
      expect(blockList.test('/p/.harness/cache-backup/metro/ab/cdef')).toBe(
        false
      );
    });

    it('keeps the harness manifest crawlable', () => {
      // The manifest is injected via `serializer.getPolyfills`, so a module
      // missing from the file map fails with `Failed to get the SHA-1`.
      const { blockList } = getBlockList(undefined);

      expect(blockList.test(getHarnessManifestPath('/p'))).toBe(false);
      expect(blockList.test('/p/.harness/manifest.js')).toBe(false);
    });

    it('adds nothing else of its own', () => {
      const { blockList } = getBlockList(undefined);

      for (const path of [
        '/p/.nx/cache/a.js',
        '/p/.gradle/caches/a.json',
        '/p/ios/Pods/Foo/foo.json',
        '/p/ios/build/Release/x.json',
        '/p/android/build/outputs/y.json',
        '/p/src/__image_snapshots__/a.png',
        '/p/packages/runtime/dist/index.js',
        '/p/node_modules/@jest/globals/build/index.js',
      ]) {
        expect(blockList.test(path), path).toBe(false);
      }
    });
  });

  describe('inheriting the project blockList', () => {
    it('honours a plain project pattern', () => {
      const { blockList, dropped } = getBlockList(/[/\\]fixtures[/\\]/);

      expect(dropped).toEqual([]);
      expect(blockList.test('/p/src/fixtures/big.json')).toBe(true);
      expect(blockList.test('/p/src/app.tsx')).toBe(false);
    });

    it('honours an array of project patterns', () => {
      const { blockList, dropped } = getBlockList([
        /[/\\]fixtures[/\\]/,
        /\.snap$/,
      ]);

      expect(dropped).toEqual([]);
      expect(blockList.test('/p/src/fixtures/big.json')).toBe(true);
      expect(blockList.test('/p/src/a.snap')).toBe(true);
    });

    it('honours an anchored project pattern', () => {
      const { blockList } = getBlockList(/^\/p\/vendor\//);

      expect(blockList.test('/p/vendor/lib.js')).toBe(true);
      expect(blockList.test('/other/p/vendor/lib.js')).toBe(false);
    });

    it('preserves group numbering so backreferences still work', () => {
      const { blockList } = getBlockList(/([/\\])dup\1/);

      expect(blockList.test('/p/dup/dup')).toBe(true);
      expect(blockList.test('/p/dup\\dup')).toBe(false);
    });

    it('adopts project flags so a case-insensitive pattern keeps working', () => {
      const { blockList, dropped } = getBlockList(/[/\\]FIXTURES[/\\]/i);

      expect(dropped).toEqual([]);
      expect(blockList.flags).toBe('i');
      expect(blockList.test('/p/src/fixtures/big.json')).toBe(true);
    });

    it('drops minority-flag patterns instead of letting Metro throw', () => {
      // Metro's array handling throws when combining mismatched flags.
      const minority = /[/\\]other[/\\]/i;
      const { blockList, dropped } = getBlockList([
        /[/\\]a[/\\]/,
        /[/\\]b[/\\]/,
        minority,
      ]);

      expect(dropped).toEqual([
        { pattern: minority, reason: 'incompatible-flags' },
      ]);
      expect(blockList.flags).toBe('');
      expect(blockList.test('/p/a/x.js')).toBe(true);
      expect(blockList.test('/p/b/x.js')).toBe(true);
    });

    it('is stateless across calls when given a global pattern', () => {
      const { blockList } = getBlockList(/[/\\]fixtures[/\\]/g);

      expect(blockList.test('/p/src/fixtures/a.json')).toBe(true);
      expect(blockList.test('/p/src/fixtures/a.json')).toBe(true);
    });
  });

  describe('carving __tests__ out of the inherited blockList', () => {
    it("keeps tests crawlable under Metro's stock blockList", () => {
      const { blockList, dropped } = getBlockList(exclusionList());

      expect(dropped).toEqual([]);
      expect(blockList.test(sys('/p/src/__tests__/smoke.harness.ts'))).toBe(
        false
      );
    });

    it("keeps a project's own exclusions while still crawling tests", () => {
      // exclusionList fuses the project's patterns and the __tests__ rule into
      // a single alternation, so the two cannot be separated by inspection.
      const { blockList, dropped } = getBlockList(
        exclusionList([/ios\/build\/.*/])
      );

      expect(dropped).toEqual([]);
      expect(blockList.test(sys('/p/ios/build/Release/x.json'))).toBe(true);
      expect(blockList.test(sys('/p/src/__tests__/smoke.harness.ts'))).toBe(
        false
      );
      expect(blockList.test(getHarnessManifestPath(sys('/p')))).toBe(false);
    });

    it('keeps tests crawlable even inside an otherwise excluded directory', () => {
      const { blockList } = getBlockList(/[/\\]generated[/\\]/);

      expect(blockList.test('/p/generated/a.js')).toBe(true);
      expect(blockList.test('/p/generated/__tests__/a.harness.ts')).toBe(false);
    });

    it('matches `inherited && !protected` for every pattern shape', () => {
      const protectedPaths = /[/\\]__tests__[/\\]/;
      const patterns = [
        exclusionList(),
        exclusionList([/ios\/build\/.*/]),
        exclusionList(['ios/build']),
        /[/\\]fixtures[/\\]/,
        /^\/p\/vendor\//,
      ];
      const paths = [
        '/p/src/__tests__/a.harness.ts',
        '/p/ios/build/Release/x.json',
        '/p/src/fixtures/big.json',
        '/p/vendor/lib.js',
        '/p/src/app.tsx',
        '/p/ios/build/__tests__/nested.harness.ts',
      ].map(sys);

      for (const pattern of patterns) {
        const { blockList } = getBlockList(pattern);

        for (const path of paths) {
          const expected =
            new RegExp(pattern.source, pattern.flags).test(path) &&
            !protectedPaths.test(path);

          expect(blockList.test(path), `${pattern} :: ${path}`).toBe(expected);
        }
      }
    });
  });
});
