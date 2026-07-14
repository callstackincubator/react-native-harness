import fs from 'node:fs';
import path from 'node:path';
import { computeMetroStaticInputs } from '@react-native-harness/cache';

const FALLBACK_BUNDLER_METRO_VERSION = 'unknown';

/**
 * Lockfiles in a monorepo often live above the Harness projectRoot, so the
 * Metro key recipe walks the ancestor chain upward from projectRoot. The git
 * repository root is the upper boundary of that walk when discoverable,
 * ensuring monorepo-root lockfiles above projectRoot are included. Falls
 * back to projectRoot itself for shallow/sparse checkouts with no `.git`
 * (limiting the walk to projectRoot alone).
 */
export const resolveRepoRoot = (projectRoot: string): string => {
  let dir = projectRoot;

  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return projectRoot;
    }

    dir = parent;
  }
};

/**
 * `@react-native-harness/bundler-metro` is rarely a direct dependency of the
 * consuming project — it's pulled in transitively through
 * `@react-native-harness/jest` (the jest preset every Harness project
 * installs directly). Package managers that don't hoist nested/transitive
 * workspace deps to the project root (e.g. pnpm) can only resolve it by
 * walking through `@react-native-harness/jest`'s own node_modules, so that's
 * tried as a fallback resolution root.
 */
const resolveBundlerMetroPackageJson = (projectRoot: string): string => {
  try {
    return require.resolve(
      '@react-native-harness/bundler-metro/package.json',
      { paths: [projectRoot] }
    );
  } catch {
    const jestPackageJsonPath = require.resolve(
      '@react-native-harness/jest/package.json',
      { paths: [projectRoot] }
    );
    return require.resolve('@react-native-harness/bundler-metro/package.json', {
      paths: [path.dirname(jestPackageJsonPath)],
    });
  }
};

/**
 * Resolved from the consuming project's own installed copy of
 * `@react-native-harness/bundler-metro`, since that's the actual Metro
 * integration whose behavior determines cache validity for that project.
 * Never throws: a broken/missing resolution degrades to a stable
 * placeholder rather than aborting the CI step.
 */
export const resolveBundlerMetroVersion = (projectRoot: string): string => {
  try {
    const packageJsonPath = resolveBundlerMetroPackageJson(projectRoot);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    if (typeof packageJson.version !== 'string') {
      throw new Error('"version" field is missing or not a string');
    }

    return packageJson.version;
  } catch (error) {
    console.warn(
      `Failed to resolve @react-native-harness/bundler-metro's version from "${projectRoot}". ` +
        `Falling back to "${FALLBACK_BUNDLER_METRO_VERSION}".`,
      error
    );
    return FALLBACK_BUNDLER_METRO_VERSION;
  }
};

/**
 * Shared by plan-restore and plan-save so both steps derive the exact same
 * staticInputs from the same recipe. computeMetroStaticInputs is
 * deterministic given the same inputs, so recomputing it in the later
 * plan-save step (rather than threading it through GITHUB_OUTPUT) is safe.
 */
export const resolveMetroStaticInputs = (options: {
  projectRoot: string;
  cacheVersionSalt?: string;
}): Record<string, string> =>
  computeMetroStaticInputs({
    projectRoot: options.projectRoot,
    repoRoot: resolveRepoRoot(options.projectRoot),
    bundlerMetroVersion: resolveBundlerMetroVersion(options.projectRoot),
    salt: options.cacheVersionSalt,
  });
