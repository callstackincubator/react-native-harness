import { EnvironmentError, MalformedModuleError } from './errors.js';

export const evaluateModule = (modulePath: string, moduleJs: string): void => {
  const __rMatch = moduleJs.match(/__r\((\d+)\)/);

  if (!__rMatch) {
    throw new MalformedModuleError(modulePath, 'No __r function found');
  }

  const __rParam = __rMatch[1];

  if (!__rParam) {
    throw new MalformedModuleError(modulePath, 'No __r parameter found');
  }

  // eslint-disable-next-line no-eval
  eval(moduleJs);

  if (!__r) {
    throw new EnvironmentError('module evaluation', '__r is not defined');
  }

  __r(Number(__rParam));
};
