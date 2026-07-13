import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { createHarnessEntryPointResolver } from '../resolvers/resolver.js';

const require = createRequire(import.meta.url);
const harnessEntryPointPath = require.resolve(
  '@react-native-harness/runtime/entry-point',
);

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
        // In this workspace, `@react-native-harness/runtime/entry-point`
        // resolves straight to the package's source file (no node_modules
        // symlink in the path) rather than a string containing the package
        // specifier, so assert on the resolved file itself.
        filePath: expect.stringMatching(/entry-point(\.[cm]?[jt]sx?)?$/),
      }),
    );
  });

  it('hijacks entry points requested relative to a monorepo server root', () => {
    const monorepoRoot = createProjectRoot();
    const projectRoot = path.join(monorepoRoot, 'apps', 'mobile');
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
          originModulePath: monorepoRoot,
        } as never,
        './apps/mobile/node_modules/expo-router/entry',
        'ios',
      ),
    ).toEqual({
      type: 'sourceFile',
      filePath: harnessEntryPointPath,
    });
  });

  it('hijacks the Expo virtual entry point', () => {
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
        './.expo/.virtual-metro-entry',
        'ios',
      ),
    ).toEqual({
      type: 'sourceFile',
      filePath: harnessEntryPointPath,
    });
  });

  it('ignores requests that do not originate from the project root or its ancestors', () => {
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
          originModulePath: path.join(projectRoot, 'src'),
        } as never,
        '../node_modules/expo-router/entry',
        'ios',
      ),
    ).toBeNull();
  });

  it('ignores non-entry modules requested from the project root', () => {
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
        './index',
        'ios',
      ),
    ).toBeNull();
  });
});
