import resolveWeakPlugin from './resolve-weak-plugin';

export const rnHarnessPlugins = [
  '@babel/plugin-transform-class-static-block',
  resolveWeakPlugin,
];

export const rnHarnessPreset = () => {
  if (!process.env.RN_HARNESS) {
    return {};
  }

  return {
    plugins: rnHarnessPlugins,
  };
};
