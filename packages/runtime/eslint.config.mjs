import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  {
    ignores: ['public', '.cache', 'node_modules', 'assets'],
  },
  {
    // The Metro and React Native implementations of the module system and the
    // host live in src/metro. Nothing else may know about them.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/metro/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^react-native\\x2F/]',
          message:
            'React Native internals belong to src/metro. Add what you need to the host.',
        },
        {
          selector:
            'Identifier[name=/^(ErrorUtils|__r|__d|__resetModule|__resetModules|__resetAllModules)$/]',
          message:
            'Metro globals belong to src/metro. Use the module system or the host.',
        },
        {
          selector:
            'Literal[value=/^[.][.]?(\\x2F[^\\x2F]+)*\\x2Fmetro(\\x2F|$)/]',
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
      ],
    },
  },
];
