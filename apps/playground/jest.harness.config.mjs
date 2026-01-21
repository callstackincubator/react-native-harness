export default {
  preset: 'react-native-harness',
  testMatch: ['<rootDir>/**/__tests__/**/*.harness.[jt]s?(x)'],
  setupFiles: ['./src/setupFile.ts'],
  setupFilesAfterEnv: ['./src/setupFileAfterEnv.ts'],
  // This is necessary to prevent Jest from transforming the workspace packages.
  // Not needed in users projects, as they will have the packages installed in their node_modules.
  transformIgnorePatterns: ['/packages/', '/node_modules/'],
  collectCoverageFrom: ['./src/**/*.(ts|tsx)'],
};
