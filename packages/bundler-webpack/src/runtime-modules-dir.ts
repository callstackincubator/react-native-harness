import { createRequire } from 'node:module';
import path from 'node:path';

const RUNTIME_PACKAGE_JSON = '@react-native-harness/runtime/package.json';

/**
 * The `node_modules` directory that holds the Harness runtime next to this
 * package, when the project cannot resolve the runtime itself (a layout where
 * only a project's own dependencies are visible to it). `undefined` when it
 * can.
 */
export const getRuntimeModulesDir = (projectRoot: string): string | undefined => {
  try {
    createRequire(path.join(projectRoot, 'package.json')).resolve(
      RUNTIME_PACKAGE_JSON
    );

    return undefined;
  } catch {
    const runtimePackage = createRequire(import.meta.url).resolve(
      RUNTIME_PACKAGE_JSON
    );

    // <modules dir>/@react-native-harness/runtime/package.json
    return path.resolve(path.dirname(runtimePackage), '..', '..');
  }
};
