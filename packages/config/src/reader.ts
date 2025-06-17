import { Config } from './types.js';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

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
      let config: Config;

      if (ext === '.mjs') {
        config = await import(filePathWithExt).then((module) => module.default);
      } else {
        const require = createRequire(import.meta.url);
        config = require(filePathWithExt);
      }

      return { config, filePathWithExt, configDir: dir };
    }
  }

  const parentDir = path.dirname(dir);
  if (parentDir === dir) {
    throw new Error(`${name} not found in any parent directory of ${dir}`);
  }

  return importUp(parentDir, name);
};

export const getConfig = async (dir: string): Promise<Config> => {
  const { config } = await importUp(dir, 'rn-harness.config');
  return {
    ...config,
    reporter: config.reporter,
  };
};
