import { MalformedModuleError } from './errors.js';
import type { ModuleId } from '../mocker/types.js';

// Metro emits `__r(123)` by default; custom module id factories (Vega
// system bundles, for example) emit quoted string ids such as `__r("1a27")`.
const REQUIRE_CALL_PATTERN = /__r\((\d+|"[^"]*"|'[^']*')\)/g;

const parseModuleId = (raw: string): ModuleId =>
  raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : Number(raw);

export const evaluateModule = (moduleJs: string, modulePath: string): void => {
  const __rMatches = Array.from(moduleJs.matchAll(REQUIRE_CALL_PATTERN));

  if (__rMatches.length === 0) {
    throw new MalformedModuleError(modulePath, 'No __r function found');
  }

  // Get the last match as there may be many require calls
  const __rMatch = __rMatches[__rMatches.length - 1];
  const __rParam = __rMatch[1];

  if (!__rParam) {
    throw new MalformedModuleError(modulePath, 'No __r parameter found');
  }

  const moduleId = parseModuleId(__rParam);

  // This is important as if module was already initialized, it would not be re-initialized
  global.__resetModule(moduleId);

  // eslint-disable-next-line no-eval
  eval(moduleJs);
};
