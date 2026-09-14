import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHarnessManifestPath, getHarnessRootPath } from '../paths.js';

describe('bundler metro paths', () => {
  it('resolves the harness root under the project root', () => {
    // An absolute path on the host OS -- `/tmp/...` is not absolute on
    // Windows, so `path.resolve` would prepend the cwd drive and the
    // assertions below would never match.
    const projectRoot = path.resolve('some-project');

    expect(getHarnessRootPath(projectRoot)).toBe(
      path.join(projectRoot, '.harness')
    );
    expect(getHarnessManifestPath(projectRoot)).toBe(
      path.join(projectRoot, '.harness', 'manifest.js')
    );
  });
});
