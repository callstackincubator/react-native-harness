import {
  spyOn,
  fn,
  clearAllMocks,
  resetAllMocks,
  restoreAllMocks,
} from './spy/index.js';
import { mock, unmock, requireActual, resetModules } from './mocker/index.js';

export type HarnessNamespace = {
  spyOn: typeof spyOn;
  fn: typeof fn;
  mock: typeof mock;
  unmock: typeof unmock;
  requireActual: typeof requireActual;
  clearAllMocks: typeof clearAllMocks;
  resetAllMocks: typeof resetAllMocks;
  restoreAllMocks: typeof restoreAllMocks;
  resetModules: typeof resetModules;
};

const createHarnessNamespace = (): HarnessNamespace => {
  return {
    spyOn,
    fn,
    mock,
    unmock,
    requireActual,
    clearAllMocks,
    resetAllMocks,
    restoreAllMocks,
    resetModules,
  };
};

export const harness = createHarnessNamespace();
