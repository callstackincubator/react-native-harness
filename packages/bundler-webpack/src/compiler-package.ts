import { createRequire } from 'node:module';
import path from 'node:path';
import { COMPILERS, type CompilerName } from './compilers.js';
import { CompilerNotFoundError } from './errors.js';
import type { CompilerConfig, Compiler } from './types.js';

type CreateCompiler = (config: CompilerConfig) => Compiler;

const isNotFound = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';

/**
 * The compiler the project's config is written for: resolved from the config
 * file, as its own `require('webpack')` is, so that the compiler and the
 * plugins in the config are the same instance. Resolved from the project root
 * when the config file cannot see it.
 */
export const getCompilerFactory = (
  compiler: CompilerName,
  projectRoot: string,
  configFile: string
): CreateCompiler => {
  const { packageName } = COMPILERS[compiler];

  for (const from of [configFile, path.join(projectRoot, 'package.json')]) {
    try {
      const compilerPackage = createRequire(from)(packageName) as
        | CreateCompiler
        | { rspack?: CreateCompiler };

      return typeof compilerPackage === 'function'
        ? compilerPackage
        : (compilerPackage.rspack as CreateCompiler);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }

  throw new CompilerNotFoundError(packageName, projectRoot);
};
