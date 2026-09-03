import { Config, ConfigSchema } from './types.js';
import {
  ConfigValidationError,
  ConfigNotFoundError,
  ConfigLoadError,
} from './errors.js';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { ZodError } from 'zod';

const extensions = ['.js', '.mjs', '.cjs', '.json'];

const importUp = async (
  dir: string,
  name: string
): Promise<{
  config: Config;
  filePathWithExt: string;
  configDir: string;
}> => {
  const filePath = path.join(dir, name);

  for (const ext of extensions) {
    const filePathWithExt = `${filePath}${ext}`;
    if (fs.existsSync(filePathWithExt)) {
      let rawConfig: unknown;

      try {
        if (ext === '.mjs') {
          // A dynamic import() of an absolute path only accepts a file:// URL.
          // On POSIX the bare path happens to work; on Windows it is read as a
          // URL and `C:` is rejected as an unknown scheme
          // (ERR_UNSUPPORTED_ESM_URL_SCHEME). pathToFileURL normalizes both.
          rawConfig = await import(pathToFileURL(filePathWithExt).href).then(
            (module) => module.default
          );
        } else {
          const require = createRequire(import.meta.url);
          rawConfig = require(filePathWithExt);
        }
      } catch (error) {
        throw new ConfigLoadError(
          filePathWithExt,
          error instanceof Error ? error : undefined
        );
      }

      try {
        const config = ConfigSchema.parse(rawConfig);
        return { config, filePathWithExt, configDir: dir };
      } catch (error) {
        if (error instanceof ZodError) {
          const validationErrors = error.errors.map((err) => {
            const path =
              err.path.length > 0 ? ` at "${err.path.join('.')}"` : '';
            return `${err.message}${path}`;
          });

          throw new ConfigValidationError(filePathWithExt, validationErrors);
        }
        throw error;
      }
    }
  }

  const parentDir = path.dirname(dir);
  if (parentDir === dir) {
    throw new ConfigNotFoundError(dir);
  }

  return importUp(parentDir, name);
};

export const getConfig = async (
  dir: string
): Promise<{ config: Config; projectRoot: string }> => {
  const { config, configDir } = await importUp(dir, 'rn-harness.config');

  return {
    config,
    projectRoot: configDir,
  };
};
