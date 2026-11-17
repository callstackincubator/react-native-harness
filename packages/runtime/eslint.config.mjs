import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

// What no file may import unless it belongs to the bundler it is written for.
const metroGlobals = {
  selector:
    'Identifier[name=/^(ErrorUtils|__r|__d|__resetModule|__resetModules|__resetAllModules)$/]',
  message:
    'Metro globals belong to src/metro. Use the module system or the host.',
};
const reactNativeInternals = {
  selector: 'Literal[value=/^react-native\\x2F/]',
  message:
    'React Native internals belong to src/metro. Add what you need to the host.',
};
const metroImports = [
  {
    selector: 'Literal[value=/^[.][.]?(\\x2F[^\\x2F]+)*\\x2Fmetro(\\x2F|$)/]',
    message:
      'Only src/metro may reference src/metro. Use the installed module system or host instead.',
  },
  {
    selector: 'Literal[value=/^metro(-[a-z-]+)?(\\x2F|$)/]',
    message: 'The metro packages belong to src/metro.',
  },
  {
    selector: 'Literal[value=/modulesOnly/]',
    message: 'The Metro bundle URL belongs to src/metro.',
  },
  {
    selector: 'TemplateElement[value.raw=/modulesOnly/]',
    message: 'The Metro bundle URL belongs to src/metro.',
  },
];
const webpackImports = [
  {
    selector:
      'Literal[value=/^[.][.]?(\\x2F[^\\x2F]+)*\\x2Fwebpack(\\x2F|$)/]',
    message:
      'Only src/webpack may reference src/webpack. Use the installed module system or host instead.',
  },
];

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  {
    ignores: ['public', '.cache', 'node_modules', 'assets'],
  },
  {
    // The Metro and React Native implementations of the module system and the
    // host live in src/metro, the browser ones in src/webpack. Nothing else
    // may know about either, and the two may not know about each other.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/metro/**', 'src/webpack/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        reactNativeInternals,
        metroGlobals,
        ...metroImports,
        ...webpackImports,
      ],
    },
  },
  {
    files: ['src/metro/**/*.ts', 'src/metro/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...webpackImports],
    },
  },
  {
    files: ['src/webpack/**/*.ts', 'src/webpack/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        reactNativeInternals,
        metroGlobals,
        ...metroImports,
      ],
    },
  },
];
