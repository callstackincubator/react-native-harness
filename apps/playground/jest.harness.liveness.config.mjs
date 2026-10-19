// Liveness e2e suite (docs/adr/0001-app-liveness-detection.md). Run
// `node scripts/generate-liveness-fixtures.mjs` first to create the large
// generated module graph, then select `liveness/pass` or a single
// `liveness/fail` file with --testPathPatterns. Files under `fail/` are
// expected to fail, with the error each one documents.
export default {
  preset: 'react-native-harness',
  testMatch: ['<rootDir>/**/__tests__/liveness/**/*.harness.[jt]s?(x)'],
  setupFiles: ['./src/setupFile.ts'],
  setupFilesAfterEnv: ['./src/setupFileAfterEnv.ts'],
  // This is necessary to prevent Jest from transforming the workspace packages.
  // Not needed in users projects, as they will have the packages installed in their node_modules.
  transformIgnorePatterns: ['/packages/', '/node_modules/'],
};
