import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHarnessManifestPath, getHarnessRootPath } from '../paths.js';

describe('bundler metro paths', () => {
  it('resolves the harness root under the project root', () => {
    const projectRoot = '/tmp/some-project';

    expect(getHarnessRootPath(projectRoot)).toBe(
      path.join(projectRoot, '.harness')
    );
    expect(getHarnessManifestPath(projectRoot)).toBe(
      path.join(projectRoot, '.harness', 'manifest.js')
    );
  });
});
