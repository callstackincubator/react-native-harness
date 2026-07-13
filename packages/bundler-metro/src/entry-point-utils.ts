import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Node's CJS resolver returns a realpath'd absolute path (symlinks
// resolved). On macOS, os.tmpdir() (and other paths) are commonly reached
// through a symlink (e.g. /var -> /private/var), so projectRoot must be
// realpath'd too before computing a relative path -- otherwise the result
// is a bogus "../../../private/var/..." path instead of the intended
// project-relative entry point.
const realpathOrSelf = (input: string): string => {
  try {
    return fs.realpathSync(input);
  } catch {
    return input;
  }
};

const CODE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx'];

const resolveWithAbsolutePath = (projectRoot: string, entryPoint: string) => {
  for (const extension of CODE_EXTENSIONS) {
    try {
      return require.resolve(entryPoint + extension, {
        paths: [projectRoot],
      });
    } catch {
      continue;
    }
  }

  return null;
};

const relativePathWithoutExtension = (
  projectRoot: string,
  pathWithExtension: string
): string => {
  const pathWithoutExtension =
    path.dirname(pathWithExtension) +
    '/' +
    path.basename(pathWithExtension, path.extname(pathWithExtension));
  return path.relative(projectRoot, pathWithoutExtension);
};

export const getResolvedEntryPointWithoutExtension = (
  projectRoot: string,
  entryPoint: string
) => {
  const realProjectRoot = realpathOrSelf(projectRoot);
  const absolutePathToEntryPoint = resolveWithAbsolutePath(
    realProjectRoot,
    entryPoint
  );

  if (!absolutePathToEntryPoint) {
    throw new Error(
      `Could not resolve entry point: ${entryPoint} in ${projectRoot}`
    );
  }

  // require.resolve returns real paths, so compute the relative path against
  // the realpath of the project root — otherwise it is wrong whenever the
  // root sits behind a symlink (e.g. /var -> /private/var on macOS).
  return relativePathWithoutExtension(
    realProjectRoot,
    absolutePathToEntryPoint
  );
};
