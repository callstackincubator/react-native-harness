import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// All `.harness/cache` layout knowledge must live in this package; other
// packages consume `HarnessCache.paths` instead of constructing cache paths
// themselves. This test scans the other packages' sources for violations.
//
// Allowlisted until phase 2 migrates them onto this package:
// - packages/tools/src/harness-artifacts.ts: getHarnessCacheRootPath, used by
//   platform-ios for the XCTest agent cache.
const ALLOWLIST = new Set(['tools/src/harness-artifacts.ts']);

const findRepoRoot = (start: string): string => {
  let dir = start;

  while (!fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find the repository root');
    }
    dir = parent;
  }

  return dir;
};

const collectSourceFiles = (dir: string, files: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '__tests__'
      ) {
        continue;
      }
      collectSourceFiles(path.join(dir, entry.name), files);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
};

const constructsHarnessCachePath = (content: string): boolean => {
  if (content.includes('.harness/cache')) {
    return true;
  }

  const hasHarnessDirLiteral =
    content.includes("'.harness'") || content.includes('".harness"');
  // A quoted 'cache' followed by `,`, `)`, or `]` is a path segment being
  // joined, as opposed to e.g. a property name in a type.
  const hasCacheSegmentLiteral = /['"]cache['"]\s*[,)\]]/.test(content);

  return hasHarnessDirLiteral && hasCacheSegmentLiteral;
};

describe('cache path boundary', () => {
  it('no package outside @react-native-harness/cache constructs .harness cache paths', () => {
    const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
    const packagesRoot = path.join(repoRoot, 'packages');

    const violations: string[] = [];

    for (const entry of fs.readdirSync(packagesRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || entry.name === 'cache') {
        continue;
      }

      const srcDir = path.join(packagesRoot, entry.name, 'src');
      if (!fs.existsSync(srcDir)) {
        continue;
      }

      for (const file of collectSourceFiles(srcDir)) {
        const relativePath = path
          .relative(packagesRoot, file)
          .split(path.sep)
          .join('/');
        if (ALLOWLIST.has(relativePath)) {
          continue;
        }

        if (constructsHarnessCachePath(fs.readFileSync(file, 'utf8'))) {
          violations.push(relativePath);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
