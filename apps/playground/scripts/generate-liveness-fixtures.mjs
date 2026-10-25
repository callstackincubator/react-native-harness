// Generates a large module graph for the liveness e2e suite: 160 modules of
// about 50 KB each (~8 MB), similar in size to the generated protobuf
// packages that made large test bundles time out. The output is not
// committed; see src/__tests__/liveness/generated/.gitignore.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_COUNT = 160;
const STRINGS_PER_MODULE = 500;
const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/__tests__/liveness/generated',
);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');

const names = [];

for (let i = 0; i < MODULE_COUNT; i++) {
  const lines = Array.from(
    { length: STRINGS_PER_MODULE },
    (_, j) => `  'message-${i}-${j}-${'x'.repeat(80)}',`,
  );
  fs.writeFileSync(
    path.join(outDir, `proto-${i}.ts`),
    `export const messages${i} = [\n${lines.join('\n')}\n];\n`,
  );
  names.push(i);
}

const half = MODULE_COUNT / 2;
const importsFor = (ids) =>
  ids.map((i) => `import { messages${i} } from './proto-${i}';`).join('\n');
const first = names.slice(0, half);
const second = names.slice(half);

// The assertion helper is imported between the generated modules, so it is
// not placed in the last chunk of the test bundle, the only one that carries
// the bundle's own sourceURL.
fs.writeFileSync(
  path.join(outDir, 'index.ts'),
  `${importsFor(first)}
export { expectMessageCount } from './assertion-helper';
${importsFor(second)}

export const allMessages = [
${names.map((i) => `  ...messages${i},`).join('\n')}
];
`,
);

fs.writeFileSync(
  path.join(outDir, 'assertion-helper.ts'),
  `import { expect } from 'react-native-harness';

export const expectMessageCount = (messages: string[], count: number) => {
  // A failure here must be reported with this file and line.
  expect(messages.length).toBe(count);
};
`,
);

const totalBytes = fs
  .readdirSync(outDir)
  .reduce((sum, file) => sum + fs.statSync(path.join(outDir, file)).size, 0);
console.log(
  `wrote ${MODULE_COUNT + 2} modules (${(totalBytes / 1024 / 1024).toFixed(1)} MB) to ${outDir}`,
);
