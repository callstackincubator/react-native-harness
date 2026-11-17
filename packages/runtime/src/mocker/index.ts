import { getModuleSystem } from '../module-system.js';

export const { mock, requireActual, unmock, resetModules } =
  getModuleSystem().createMockRegistry();
