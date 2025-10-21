import type { Require } from './types.js';

declare global {
  var __r: Require;
  var __resetAllModules: () => void;
  var __clearModule: (moduleId: number) => void;
}
