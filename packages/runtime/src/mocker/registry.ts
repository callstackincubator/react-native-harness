import { ModuleFactory, ModuleId, Require } from './types.js';

const mockRegistry = new Map<number, ModuleFactory>();
const mockCache = new Map<number, unknown>();

const originalRequire = global.__r;

export const mock = (moduleId: string, factory: ModuleFactory): void => {
  mockCache.delete(moduleId as unknown as ModuleId);
  mockRegistry.set(moduleId as unknown as ModuleId, factory);
};

export const clearMocks = (): void => {
  mockRegistry.clear();
  mockCache.clear();
};

const getMockImplementation = (moduleId: number): unknown | null => {
  if (mockCache.has(moduleId)) {
    return mockCache.get(moduleId);
  }

  const factory = mockRegistry.get(moduleId);
  if (!factory) {
    return null;
  }

  const implementation = factory();
  mockCache.set(moduleId, implementation);
  return implementation;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const requireActual = <T = any>(moduleId: string): T =>
  // babel plugin will transform 'moduleId' to a number
  originalRequire(moduleId as unknown as ModuleId) as T;

export const unmock = (moduleId: string) => {
  mockRegistry.delete(moduleId as unknown as ModuleId);
  mockCache.delete(moduleId as unknown as ModuleId);
};

export const resetModules = (): void => {
  mockCache.clear();

  // Reset Metro's module cache
  global.__resetAllModules();
};

const mockRequire = (moduleId: string) => {
  // babel plugin will transform 'moduleId' to a number
  const mockedModule = getMockImplementation(moduleId as unknown as ModuleId);

  if (mockedModule) {
    return mockedModule;
  }

  return originalRequire(moduleId as unknown as ModuleId);
};

Object.setPrototypeOf(mockRequire, Object.getPrototypeOf(originalRequire));
Object.defineProperties(
  mockRequire,
  Object.getOwnPropertyDescriptors(originalRequire)
);
global.__r = mockRequire as unknown as Require;
