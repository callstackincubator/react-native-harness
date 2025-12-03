import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          // jest-runner: we only ingest types
          ignoredDependencies: ['@react-native-harness/cli', 'jest-runner'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
