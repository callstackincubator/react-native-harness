import {
  spyOn,
  fn,
  clearAllMocks,
  resetAllMocks,
  restoreAllMocks,
} from './spy/index.js';
import { mock, unmock, requireActual, resetModules } from './mocker/index.js';
import { waitFor, waitUntil } from './waitFor.js';

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
  waitFor: typeof waitFor;
  waitUntil: typeof waitUntil;
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
    waitFor,
    waitUntil,
  };
};

export const harness = createHarnessNamespace();
