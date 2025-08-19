import globalRnHarnessPlugin from './global-plugin';
import resolveWeakPlugin from './resolve-weak-plugin';

export const rnHarnessPreset = () => {
  return {
    plugins: [
      '@babel/plugin-transform-class-static-block',
      globalRnHarnessPlugin,
      resolveWeakPlugin,
    ],
  };
};
