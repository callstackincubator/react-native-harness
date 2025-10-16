module.exports = {
  projects: [
    {
      runner: '@react-native-harness/jest',
      testMatch: [
        '<rootDir>/src/__tests__/**/*.(test|spec|harness).(js|jsx|ts|tsx)',
      ],
    },
  ],
};
