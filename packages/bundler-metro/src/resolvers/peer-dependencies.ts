import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { realpathOrSelf } from '../entry-point-utils.js';
import type { MetroResolver } from './types.js';

const require = createRequire(import.meta.url);

const HARNESS_PACKAGE_SCOPE = '@react-native-harness/';

type PackageJson = {
  name?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const readPackageJson = (packageRoot: string): PackageJson | undefined => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
    ) as PackageJson;
  } catch {
    return undefined;
  }
};

const readPackageName = (packageRoot: string): string | undefined => {
  const name = readPackageJson(packageRoot)?.name;
  return typeof name === 'string' ? name : undefined;
};

// A file belongs to the package named by the nearest package.json that has a
// name; answers are cached per directory.
const createHarnessModuleMatcher = (): ((filePath: string) => boolean) => {
  const packageNames = new Map<string, string | null>();

  const findPackageName = (directory: string): string | null => {
    const cached = packageNames.get(directory);
    if (cached !== undefined) {
      return cached;
    }

    const parentDirectory = path.dirname(directory);
    const packageName =
      readPackageName(directory) ??
      (parentDirectory === directory ? null : findPackageName(parentDirectory));
    packageNames.set(directory, packageName);
    return packageName;
  };

  return (filePath) =>
    findPackageName(path.dirname(filePath))?.startsWith(
      HARNESS_PACKAGE_SCOPE
    ) ?? false;
};

// The real directories of a package and of every package its dependencies
// pull in, each found where Node would find it from the package depending on
// it.
const collectDependencyRoots = (packageRoot: string): string[] => {
  const roots = new Set<string>();
  const pending = [realpathOrSelf(packageRoot)];

  for (let root = pending.pop(); root !== undefined; root = pending.pop()) {
    if (roots.has(root)) {
      continue;
    }
    roots.add(root);

    const lookupPaths =
      createRequire(path.join(root, 'package.json')).resolve.paths('') ?? [];
    for (const name of Object.keys(readPackageJson(root)?.dependencies ?? {})) {
      const dependencyRoot = lookupPaths
        .map((lookupPath) => path.join(lookupPath, name))
        .find((directory) =>
          fs.existsSync(path.join(directory, 'package.json'))
        );
      if (dependencyRoot) {
        pending.push(realpathOrSelf(dependencyRoot));
      }
    }
  }

  return [...roots];
};

// A file belongs to the runtime's dependencies when its real path lies in one
// of their directories; answers are cached per directory.
const createRuntimeDependencyMatcher = (
  runtimeRoot: string
): ((filePath: string) => boolean) => {
  const dependencyRoots = collectDependencyRoots(runtimeRoot);
  const answers = new Map<string, boolean>();

  return (filePath) => {
    const directory = path.dirname(filePath);
    const cached = answers.get(directory);
    if (cached !== undefined) {
      return cached;
    }

    const realDirectory = realpathOrSelf(directory);
    const answer = dependencyRoots.some(
      (root) =>
        realDirectory === root || realDirectory.startsWith(root + path.sep)
    );
    answers.set(directory, answer);
    return answer;
  };
};

/**
 * The runtime's peer dependencies — `react` and `react-native` — resolve from
 * the project when Harness's code imports them: its own packages and every
 * package the runtime's dependencies bring into the bundle, such as zustand's
 * React bindings. In a monorepo that code sits outside the app, so it would
 * otherwise reach another copy than the app's files, and the bundle would
 * carry two React Natives with separate registries, or two Reacts. Every
 * other import resolves as it did.
 *
 * It wraps the final resolver, after a platform's `metroConfigEnhancer`, so a
 * platform that renames `react-native` to its own fork resolves the fork from
 * the project too.
 */
export const resolvePeerDependenciesFromProject = (
  resolveRequest: MetroResolver,
  projectRoot: string,
  runtimeRoot = path.dirname(
    require.resolve('@react-native-harness/runtime/package.json')
  )
): MetroResolver => {
  const peerNames = Object.keys(
    readPackageJson(runtimeRoot)?.peerDependencies ?? {}
  );
  const isPeerDependency = (moduleName: string): boolean =>
    peerNames.some(
      (peerName) =>
        moduleName === peerName || moduleName.startsWith(`${peerName}/`)
    );
  const isHarnessModule = createHarnessModuleMatcher();
  const isRuntimeDependencyModule = createRuntimeDependencyMatcher(runtimeRoot);
  const projectOrigin = path.join(projectRoot, 'package.json');

  return (context, moduleName, platform) =>
    resolveRequest(
      isPeerDependency(moduleName) &&
        (isHarnessModule(context.originModulePath) ||
          isRuntimeDependencyModule(context.originModulePath))
        ? { ...context, originModulePath: projectOrigin }
        : context,
      moduleName,
      platform
    );
};
