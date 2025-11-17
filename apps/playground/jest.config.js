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
    },
  ],
  collectCoverageFrom: ['./src/**/*.(ts|tsx)'],
};
