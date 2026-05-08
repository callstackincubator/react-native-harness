import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const extensions = ['.mjs', '.js', '.cjs'];

function findConfig(dir) {
  for (const ext of extensions) {
    const filePath = path.join(dir, `rn-harness.config${ext}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  const parent = path.dirname(dir);
  if (parent === dir) return null;
  return findConfig(parent);
}

try {
  const configPath = findConfig(process.cwd());
  if (!configPath) {
    console.log('[]');
    process.exit(0);
  }

  let rawConfig;
  if (configPath.endsWith('.mjs')) {
    rawConfig = await import(pathToFileURL(configPath).href).then(m => m.default);
  } else {
    const require = createRequire(import.meta.url);
    rawConfig = require(configPath);
  }

  const pods = rawConfig?.coverage?.native?.ios?.pods ?? [];
  console.log(JSON.stringify(pods));
} catch {
  console.log('[]');
}
