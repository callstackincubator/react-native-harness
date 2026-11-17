import path from 'path';

/**
 * The Babel plugin that collects coverage when Jest runs with `--coverage`,
 * which `harness-session.ts` tells through `RN_HARNESS_COLLECT_COVERAGE` and
 * `RN_HARNESS_COVERAGE_ROOT`. Shared by the Metro preset and the loader the
 * webpack bundler uses.
 */
export const getIstanbulPlugin = (): string | [string, object] | null => {
  if (!process.env.RN_HARNESS_COLLECT_COVERAGE) {
    return null;
  }

  const coverageRoot = process.env.RN_HARNESS_COVERAGE_ROOT;
  if (coverageRoot) {
    return [
      'babel-plugin-istanbul',
      { cwd: path.resolve(process.cwd(), coverageRoot) },
    ];
  }

  return 'babel-plugin-istanbul';
};
