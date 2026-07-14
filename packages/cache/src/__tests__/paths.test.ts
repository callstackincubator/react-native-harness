import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHarnessCachePaths } from '../paths.js';

describe('createHarnessCachePaths', () => {
  it('nests cache paths under <projectRoot>/.harness/cache', () => {
    const projectRoot = '/tmp/some-project';
    const paths = createHarnessCachePaths(projectRoot);

    expect(paths.root).toBe(path.join(projectRoot, '.harness', 'cache'));
    expect(paths.metroTransform).toBe(
      path.join(projectRoot, '.harness', 'cache', 'metro')
    );
    expect(paths.metroFileMap).toBe(
      path.join(projectRoot, '.harness', 'cache', 'metro-file-map')
    );
  });
});
