import { defineConfig } from 'tsup';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('../../actions');
const TARGETS = ['ios', 'android', 'web'];

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve('./package.json'), 'utf8')
);

export default defineConfig({
  entry: {
    ...Object.fromEntries(
      TARGETS.map((target) => [`${target}/index`, `src/${target}/index.ts`])
    ),
    'shared/index': 'src/shared/index.ts',
  },
  outDir: OUT_DIR,
  format: 'cjs',
  dts: false,
  platform: 'node',
  clean: true,
  bundle: true,
  noExternal: Object.keys(packageJson.dependencies || {}),
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.mjs' }),
  onSuccess: async () => {
    TARGETS.forEach((target) => {
      fs.copyFileSync(
        path.resolve(`./src/${target}/action.yml`),
        path.resolve(OUT_DIR, `./${target}/action.yml`)
      );
    });
  },
});
