import { ModuleFactory, ModuleId } from './types.js';

const mockRegistry = new Map<number, ModuleFactory>();
const mockCache = new Map<number, unknown>();

const originalRequire = global.__r;

export const mock = (moduleId: ModuleId, factory: ModuleFactory): void => {
  mockCache.delete(moduleId);
  mockRegistry.set(moduleId, factory);
};

export const clearMocks = (): void => {
  mockRegistry.clear();
  mockCache.clear();
};

export const getMockRegistry = (): Map<number, ModuleFactory> => {
  return mockRegistry;
};

export const getMockImplementation = (moduleId: number): unknown | null => {
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
export const requireActual = <T = any>(moduleId: ModuleId): T =>
  originalRequire(moduleId) as T;

const mockRequire = (moduleId: ModuleId) => {
  const mockedModule = getMockImplementation(moduleId);

  if (mockedModule) {
    return mockedModule;
  }

  return originalRequire(moduleId);
};

Object.setPrototypeOf(mockRequire, Object.getPrototypeOf(originalRequire));
Object.defineProperties(
  mockRequire,
  Object.getOwnPropertyDescriptors(originalRequire)
);
global.__r = mockRequire;
