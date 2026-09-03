import path from 'node:path';

/**
 * The workspace root that INPUT_PROJECTROOT and the emitted `projectRoot`
 * output are resolved against. GitHub Actions sets GITHUB_WORKSPACE to the
 * checkout root for every step, regardless of that step's
 * `working-directory` -- and the composite action sets `working-directory`
 * on these steps so `pnpm exec` / `npx` resolves the project's own installed
 * binary. Anchoring path resolution to GITHUB_WORKSPACE (rather than
 * process.cwd()) keeps `INPUT_PROJECTROOT` and `projectRoot` consistently
 * workspace-root-relative no matter which directory a step actually runs in.
 * Falls back to process.cwd() so the CLI still behaves sensibly when
 * invoked locally, outside of GitHub Actions.
 */
export const getWorkspaceRoot = (): string =>
  process.env.GITHUB_WORKSPACE ?? process.cwd();

/**
 * Resolves the project root from the (possibly relative, possibly unset)
 * INPUT_PROJECTROOT value, always against the workspace root -- never
 * against process.cwd(), which varies per step via `working-directory`.
 */
export const resolveProjectRoot = (
  projectRootInput: string | undefined
): string => {
  const workspaceRoot = getWorkspaceRoot();
  return projectRootInput
    ? path.resolve(workspaceRoot, projectRootInput)
    : workspaceRoot;
};

/**
 * Mirrors resolveProjectRoot's base so the `projectRoot` value emitted to
 * GITHUB_OUTPUT is relative to the workspace root, matching what
 * downstream non-bash steps (actions/cache, actions/upload-artifact,
 * hashFiles(...)) resolve paths against.
 *
 * Emitted with forward slashes so the value is stable across runner OSes:
 * `actions/cache` globs, `hashFiles()`, and a bash `working-directory` all
 * accept `/` on Windows, whereas a raw `path.relative` result would be
 * `apps\foo` there.
 */
export const relativeToWorkspaceRoot = (target: string): string =>
  (path.relative(getWorkspaceRoot(), target) || '.').split(path.sep).join('/');
