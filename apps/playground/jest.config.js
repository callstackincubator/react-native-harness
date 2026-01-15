module.exports = {
  projects: [
    {
      displayName: 'react-native-harness',
      preset: 'react-native-harness',
      testMatch: [
        '<rootDir>/src/__tests__/**/*.(test|spec|harness).(js|jsx|ts|tsx)',
      ],
      setupFiles: ['./src/setupFile.ts'],
      setupFilesAfterEnv: ['./src/setupFileAfterEnv.ts'],
      // This is necessary to prevent Jest from transforming the workspace packages.
      // Not needed in users projects, as they will have the packages installed in their node_modules.
      transformIgnorePatterns: ['/packages/', '/node_modules/'],
    },
  ],
  collectCoverageFrom: ['./src/**/*.(ts|tsx)'],
};
