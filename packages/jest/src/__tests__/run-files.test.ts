import { describe, expect, it } from 'vitest';
import type { Config, Test } from 'jest-runner';
import { collectRunFiles } from '../run-files.js';

const makeTest = (
  testPath: string,
  config: Partial<Config.ProjectConfig> = {}
): Test =>
  ({
    path: testPath,
    context: { config: config as Config.ProjectConfig },
  }) as Test;

describe('collectRunFiles', () => {
  const known = new Set(['web', 'ios']);

  it('lists the test files and the setup files of their projects, relative to the root', () => {
    const config = {
      setupFiles: ['/project/src/setup.ts'],
      setupFilesAfterEnv: ['/project/src/setup-after-env.ts'],
    };

    expect(
      collectRunFiles({
        tests: [
          makeTest('/project/src/__tests__/a.harness.ts', config),
          makeTest('/project/src/__tests__/b.harness.ts', config),
        ],
        rootDir: '/project',
        platformId: 'web',
        knownPlatformIds: known,
      })
    ).toEqual([
      'src/__tests__/a.harness.ts',
      'src/setup.ts',
      'src/setup-after-env.ts',
      'src/__tests__/b.harness.ts',
    ]);
  });

  it('tolerates a project without setup files', () => {
    expect(
      collectRunFiles({
        tests: [makeTest('/project/a.harness.ts')],
        rootDir: '/project',
        platformId: 'web',
        knownPlatformIds: known,
      })
    ).toEqual(['a.harness.ts']);
  });

  it('leaves out files for another platform, which are not run', () => {
    expect(
      collectRunFiles({
        tests: [
          makeTest('/project/a.harness.ts'),
          makeTest('/project/b.ios.harness.ts'),
        ],
        rootDir: '/project',
        platformId: 'web',
        knownPlatformIds: known,
      })
    ).toEqual(['a.harness.ts']);
  });
});
