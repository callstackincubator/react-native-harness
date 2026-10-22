import { ModuleFactory, ModuleId, Require } from './types.js';

const modulesCache = new Map<ModuleId, unknown>();
const mockRegistry = new Map<ModuleId, ModuleFactory>();

const originalRequire = global.__r;

export const mock = (moduleId: string, factory: ModuleFactory): void => {
  modulesCache.delete(moduleId as unknown as ModuleId);
  mockRegistry.set(moduleId as unknown as ModuleId, factory);
};

const isModuleMocked = (moduleId: ModuleId): boolean => {
  return mockRegistry.has(moduleId);
};

const getMockImplementation = (moduleId: ModuleId): unknown | null => {
  const factory = mockRegistry.get(moduleId);
  
  if (!factory) {
    return null;
  }

  const implementation = factory();
  modulesCache.set(moduleId, implementation);
  return implementation;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const requireActual = <T = any>(moduleId: string): T =>
  // babel plugin will transform 'moduleId' to a number
  originalRequire(moduleId as unknown as ModuleId) as T;

export const unmock = (moduleId: string) => {
  mockRegistry.delete(moduleId as unknown as ModuleId);
  modulesCache.delete(moduleId as unknown as ModuleId);
};

export const resetModules = (): void => {
  modulesCache.clear();
  mockRegistry.clear();
};

const mockRequire = (moduleId: string) => {
  // babel plugin will transform 'moduleId' to a number
  const moduleIdNumber = moduleId as unknown as ModuleId;
  const cachedModule = modulesCache.get(moduleIdNumber);

  if (cachedModule) {
    return cachedModule;
  }

  if (isModuleMocked(moduleIdNumber)) {
    const mockedModule = getMockImplementation(moduleIdNumber);
    modulesCache.set(moduleIdNumber, mockedModule);
    return mockedModule;
  }

  const originalModule = originalRequire(moduleIdNumber);
  modulesCache.set(moduleIdNumber, originalModule);
  return originalModule;
};

Object.setPrototypeOf(mockRequire, Object.getPrototypeOf(originalRequire));
Object.defineProperties(
  mockRequire,
  Object.getOwnPropertyDescriptors(originalRequire)
);
global.__r = mockRequire as unknown as Require;

// `__resetModule` forces Metro to re-run a module's factory on the next
// `__r(id)`. `mockRequire` would still answer from `modulesCache` without ever
// reaching Metro, so a re-evaluated module (e.g. the same test file on a later
// run in watch mode) would silently not execute. Drop the cached entry too.
const originalResetModule = global.__resetModule;
global.__resetModule = (moduleId) => {
  modulesCache.delete(moduleId);
  originalResetModule?.(moduleId);
};
