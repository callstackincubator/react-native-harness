import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { createHarnessEntryPointResolver } from '../resolvers/resolver.js';

const tempDirs: string[] = [];

const createProjectRoot = (): string => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rn-harness-entry-resolver-'),
  );
  tempDirs.push(projectRoot);
  return projectRoot;
};

afterEach(() => {
  vi.restoreAllMocks();

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('createHarnessEntryPointResolver', () => {
  it('hijacks bare package entry points resolved from the project root', () => {
    const projectRoot = createProjectRoot();
    const entryPointPath = path.join(
      projectRoot,
      'node_modules',
      'expo-router',
      'entry.js',
    );

    fs.mkdirSync(path.dirname(entryPointPath), { recursive: true });
    fs.writeFileSync(entryPointPath, 'export {};');

    vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    const resolver = createHarnessEntryPointResolver({
      entryPoint: 'expo-router/entry',
    } as HarnessConfig);

    expect(
      resolver(
        {
          originModulePath: projectRoot,
        } as never,
        './node_modules/expo-router/entry',
        'android',
      ),
    ).toEqual(
      expect.objectContaining({
        type: 'sourceFile',
        filePath: expect.stringContaining(
          '@react-native-harness/runtime/entry-point',
        ),
      }),
    );
  });
});
