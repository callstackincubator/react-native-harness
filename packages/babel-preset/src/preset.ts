import resolveWeakPlugin from './resolve-weak-plugin';
import path from 'path';

const getIstanbulPlugin = (): string | [string, object] | null => {
  if (!process.env.RN_HARNESS_COLLECT_COVERAGE) {
    return null;
  }

  const coverageRoot = process.env.RN_HARNESS_COVERAGE_ROOT;
  if (coverageRoot) {
    return [
      'babel-plugin-istanbul',
      { cwd: path.resolve(process.cwd(), coverageRoot) },
    ];
  }

  return 'babel-plugin-istanbul';
};

export const rnHarnessPlugins = [
  '@babel/plugin-transform-class-static-block',
  resolveWeakPlugin,
  getIstanbulPlugin(),
].filter((plugin) => plugin !== null);

export const rnHarnessPreset = () => {
  if (!process.env.RN_HARNESS) {
    return {};
  }

  return {
    plugins: rnHarnessPlugins,
  };
};
