import fs from 'node:fs';
import path from 'node:path';
import { computeMetroStaticInputs } from '@react-native-harness/cache';

const FALLBACK_BUNDLER_METRO_VERSION = 'unknown';

/**
 * Lockfiles in a monorepo often live above the Harness projectRoot, so the
 * Metro key recipe walk anchors at the git repository root when discoverable
 * (mirroring how action.yml's `hashFiles('**\/pnpm-lock.yaml', ...)` today
 * searches from the workflow's checkout root, not from projectRoot), falling
 * back to projectRoot itself for shallow/sparse checkouts with no `.git`.
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
 * Resolved from the consuming project's own installed copy of
 * `@react-native-harness/bundler-metro`, since that's the actual Metro
 * integration whose behavior determines cache validity for that project.
 * Never throws: a broken/missing resolution degrades to a stable
 * placeholder rather than aborting the CI step.
 */
export const resolveBundlerMetroVersion = (projectRoot: string): string => {
  try {
    const packageJsonPath = require.resolve(
      '@react-native-harness/bundler-metro/package.json',
      { paths: [projectRoot] }
    );
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
    repoRoot: resolveRepoRoot(options.projectRoot),
    bundlerMetroVersion: resolveBundlerMetroVersion(options.projectRoot),
    salt: options.cacheVersionSalt,
  });
