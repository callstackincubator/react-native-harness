import resolveWeakPlugin from './resolve-weak-plugin';

export const rnHarnessPreset = () => {
  if (!process.env.RN_HARNESS) {
    return {};
  }

  return {
    plugins: ['@babel/plugin-transform-class-static-block', resolveWeakPlugin],
  };
};
