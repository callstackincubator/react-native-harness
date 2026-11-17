import resolveWeakPlugin from './resolve-weak-plugin';
import { getIstanbulPlugin } from './istanbul-plugin';

export const rnHarnessPlugins = [
  '@babel/plugin-transform-class-static-block',
  resolveWeakPlugin,
  getIstanbulPlugin(),
  [
    '@babel/plugin-transform-react-jsx',
    {
      runtime: 'automatic',
      importSource: '@react-native-harness/runtime',
    },
  ],
].filter((plugin) => plugin !== null);

export const rnHarnessPreset = () => {
  if (!process.env.RN_HARNESS) {
    return {};
  }

  return {
    plugins: rnHarnessPlugins,
  };
};
