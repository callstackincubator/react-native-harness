import { MalformedModuleError } from './errors.js';

export const evaluateModule = (moduleJs: string, modulePath: string): void => {
  const __rMatches = Array.from(moduleJs.matchAll(/__r\((\d+)\)/g));

  if (__rMatches.length === 0) {
    throw new MalformedModuleError(modulePath, 'No __r function found');
  }

  // Get the last match as there may be many require calls
  const __rMatch = __rMatches[__rMatches.length - 1];
  const __rParam = __rMatch[1];

  if (!__rParam) {
    throw new MalformedModuleError(modulePath, 'No __r parameter found');
  }

  const moduleId = Number(__rParam);

  // This is important as if module was already initialized, it would not be re-initialized
  global.__resetModule(moduleId);

  // eslint-disable-next-line no-eval
  eval(moduleJs);
};
