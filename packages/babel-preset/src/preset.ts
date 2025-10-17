import resolveWeakPlugin from './resolve-weak-plugin';

export const rnHarnessPlugins = [
  '@babel/plugin-transform-class-static-block',
  resolveWeakPlugin,
  process.env.RN_HARNESS_COLLECT_COVERAGE ? 'babel-plugin-istanbul' : null,
].filter((plugin): plugin is string => plugin !== null);

export const rnHarnessPreset = () => {
  if (!process.env.RN_HARNESS) {
    return {};
  }

  return {
    plugins: rnHarnessPlugins,
  };
};
