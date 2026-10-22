import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomResolutionContext } from 'metro-resolver';
import { resolvePeerDependenciesFromProject } from '../resolvers/peer-dependencies.js';
import type { MetroResolver } from '../resolvers/types.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

const writeFile = (filePath: string, content: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

const createProject = () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rn-harness-peer-dependencies-')
  );
  tempDirs.push(projectRoot);

  const runtimeRoot = path.join(
    projectRoot,
    'node_modules',
    '.pnpm',
    '@react-native-harness+runtime@1.0.0',
    'node_modules',
    '@react-native-harness',
    'runtime'
  );
  writeFile(
    path.join(runtimeRoot, 'package.json'),
    JSON.stringify({
      name: '@react-native-harness/runtime',
      dependencies: { zustand: '^5.0.0' },
      peerDependencies: { react: '*', 'react-native': '*' },
    })
  );
  writeFile(
    path.join(runtimeRoot, 'dist', 'package.json'),
    JSON.stringify({ type: 'module' })
  );
  writeFile(path.join(runtimeRoot, 'dist', 'index.js'), 'export {};');

  // pnpm links a package's dependencies beside it, to directories of their own.
  const storeRoot = path.join(projectRoot, 'node_modules', '.pnpm');
  const zustandRoot = path.join(
    storeRoot,
    'zustand@5.0.0',
    'node_modules',
    'zustand'
  );
  writeFile(
    path.join(zustandRoot, 'package.json'),
    JSON.stringify({
      name: 'zustand',
      dependencies: { 'use-sync-external-store': '^1.6.0' },
    })
  );
  writeFile(path.join(zustandRoot, 'esm', 'react.mjs'), 'export {};');
  fs.symlinkSync(
    zustandRoot,
    path.join(path.dirname(path.dirname(runtimeRoot)), 'zustand'),
    'junction'
  );

  const selectorRoot = path.join(
    storeRoot,
    'zustand@5.0.0',
    'node_modules',
    'use-sync-external-store'
  );
  writeFile(
    path.join(selectorRoot, 'package.json'),
    JSON.stringify({ name: 'use-sync-external-store' })
  );
  writeFile(path.join(selectorRoot, 'shim', 'with-selector.js'), '');

  const libraryRoot = path.join(projectRoot, 'node_modules', 'some-library');
  writeFile(
    path.join(libraryRoot, 'package.json'),
    JSON.stringify({ name: 'some-library' })
  );
  writeFile(path.join(libraryRoot, 'index.js'), 'export {};');

  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'app' })
  );
  writeFile(path.join(projectRoot, 'src', 'App.js'), 'export {};');

  return {
    projectOrigin: path.join(projectRoot, 'package.json'),
    projectRoot,
    runtimeRoot,
    harnessModule: path.join(runtimeRoot, 'dist', 'index.js'),
    runtimeDependencyModule: path.join(zustandRoot, 'esm', 'react.mjs'),
    linkedRuntimeDependencyModule: path.join(
      path.dirname(path.dirname(runtimeRoot)),
      'zustand',
      'esm',
      'react.mjs'
    ),
    transitiveRuntimeDependencyModule: path.join(
      selectorRoot,
      'shim',
      'with-selector.js'
    ),
    libraryModule: path.join(libraryRoot, 'index.js'),
    appModule: path.join(projectRoot, 'src', 'App.js'),
  };
};

const createInnerResolver = () =>
  vi.fn<MetroResolver>(() => ({ type: 'empty' }));

const resolveFrom = (
  resolveRequest: MetroResolver,
  originModulePath: string,
  moduleName: string
) =>
  resolveRequest(
    { originModulePath } as CustomResolutionContext,
    moduleName,
    'android'
  );

describe('resolvePeerDependenciesFromProject', () => {
  it.each([
    'react-native',
    'react-native/Libraries/Core/InitializeCore',
    'react',
    'react/jsx-runtime',
  ])(
    "resolves %s from the project when Harness's runtime imports it",
    (moduleName) => {
      const project = createProject();
      const inner = createInnerResolver();

      resolveFrom(
        resolvePeerDependenciesFromProject(
          inner,
          project.projectRoot,
          project.runtimeRoot
        ),
        project.harnessModule,
        moduleName
      );

      expect(inner).toHaveBeenCalledWith(
        expect.objectContaining({ originModulePath: project.projectOrigin }),
        moduleName,
        'android'
      );
    }
  );

  it.each([
    'react-native-web',
    'react-native-reanimated',
    'react-dom',
    '@react-native/assets-registry/registry',
    './Libraries/Core/InitializeCore',
  ])('leaves %s where Harness requested it from', (moduleName) => {
    const project = createProject();
    const inner = createInnerResolver();

    resolveFrom(
      resolvePeerDependenciesFromProject(
        inner,
        project.projectRoot,
        project.runtimeRoot
      ),
      project.harnessModule,
      moduleName
    );

    expect(inner).toHaveBeenCalledWith(
      expect.objectContaining({ originModulePath: project.harnessModule }),
      moduleName,
      'android'
    );
  });

  it.each([
    'runtimeDependencyModule',
    'linkedRuntimeDependencyModule',
    'transitiveRuntimeDependencyModule',
  ] as const)(
    'resolves react and react-native from the project when the %s requests them',
    (importer) => {
      const project = createProject();
      const inner = createInnerResolver();
      const resolveRequest = resolvePeerDependenciesFromProject(
        inner,
        project.projectRoot,
        project.runtimeRoot
      );

      resolveFrom(resolveRequest, project[importer], 'react');
      resolveFrom(resolveRequest, project[importer], 'react-native');

      for (const [context] of inner.mock.calls) {
        expect(context.originModulePath).toBe(project.projectOrigin);
      }
      expect(inner).toHaveBeenCalledTimes(2);
    }
  );

  it.each(['libraryModule', 'appModule'] as const)(
    'leaves react and react-native where the %s requested them from',
    (importer) => {
      const project = createProject();
      const inner = createInnerResolver();
      const resolveRequest = resolvePeerDependenciesFromProject(
        inner,
        project.projectRoot,
        project.runtimeRoot
      );

      resolveFrom(resolveRequest, project[importer], 'react');
      resolveFrom(resolveRequest, project[importer], 'react-native');

      for (const [context] of inner.mock.calls) {
        expect(context.originModulePath).toBe(project[importer]);
      }
      expect(inner).toHaveBeenCalledTimes(2);
    }
  );

  it("resolves a platform's react-native fork from the project when the platform renames it inside", () => {
    const project = createProject();
    const inner = createInnerResolver();
    const platformResolver: MetroResolver = (context, moduleName, platform) =>
      inner(
        context,
        moduleName === 'react-native' ? 'react-native-windows' : moduleName,
        platform
      );

    resolveFrom(
      resolvePeerDependenciesFromProject(
        platformResolver,
        project.projectRoot,
        project.runtimeRoot
      ),
      project.harnessModule,
      'react-native'
    );

    expect(inner).toHaveBeenCalledWith(
      expect.objectContaining({ originModulePath: project.projectOrigin }),
      'react-native-windows',
      'android'
    );
  });
});
