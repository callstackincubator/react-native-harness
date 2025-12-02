import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

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
  const absolutePathToEntryPoint = resolveWithAbsolutePath(
    projectRoot,
    entryPoint
  );

  if (!absolutePathToEntryPoint) {
    throw new Error(
      `Could not resolve entry point: ${entryPoint} in ${projectRoot}`
    );
  }

  return relativePathWithoutExtension(projectRoot, absolutePathToEntryPoint);
};
