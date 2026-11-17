import fs from 'node:fs';
import path from 'node:path';

/** The Harness packages. The Harness runtime is ESM that calls `require`. */
export const HARNESS_PACKAGE = /^(?:@react-native-harness\/|react-native-harness$)/;

const readPackageName = (directory: string): string | undefined => {
  try {
    const { name } = JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8')
    ) as { name?: unknown };

    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
};

const isInside = (directory: string, file: string): boolean => {
  const relative = path.relative(directory, file);

  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * Tells whether a file belongs to one of Harness's own packages. Files of the
 * project do not, even when the project's package has a Harness name (the
 * sandbox app does). Packages installed from npm live under `node_modules`,
 * which callers exclude on their own; this finds the workspace packages that
 * resolve outside it.
 */
export const createHarnessFileMatcher = (
  projectRoot: string
): ((file: string) => boolean) => {
  const packageNames = new Map<string, string | undefined>();

  const findPackageName = (directory: string): string | undefined => {
    if (packageNames.has(directory)) {
      return packageNames.get(directory);
    }

    const name =
      readPackageName(directory) ??
      (path.dirname(directory) === directory
        ? undefined
        : findPackageName(path.dirname(directory)));
    packageNames.set(directory, name);

    return name;
  };

  return (file) => {
    if (isInside(projectRoot, file)) {
      return false;
    }

    const name = findPackageName(path.dirname(file));

    return name !== undefined && HARNESS_PACKAGE.test(name);
  };
};
