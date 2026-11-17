import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('react-native/Libraries/Core/Devtools/getDevServer', () => ({
  default: vi.fn(),
}));
vi.mock('react-native/Libraries/Core/Devtools/parseErrorStack', () => ({
  default: vi.fn(),
}));

describe('mocker registry module reset', () => {
  const factory = vi.fn();
  const metroReset = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    factory.mockReset();
    factory.mockImplementation(() => ({ run: 'exports' }));
    const originalRequire = Object.assign(
      (id: number) => (factory(id) as unknown),
      { getModules: vi.fn() },
    );
    vi.stubGlobal('__r', originalRequire);
    vi.stubGlobal('__resetModule', metroReset);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    metroReset.mockReset();
  });

  it('re-runs a module after it was reset', async () => {
    const { createMockRegistry } = await import('./mock-registry.js');
    createMockRegistry();

    global.__r(7);
    global.__r(7);
    expect(factory).toHaveBeenCalledTimes(1);

    global.__resetModule(7);
    global.__r(7);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(metroReset).toHaveBeenCalledWith(7);
  });

  it('keeps other modules cached when one is reset', async () => {
    const { createMockRegistry } = await import('./mock-registry.js');
    createMockRegistry();

    global.__r(1);
    global.__r(2);
    global.__resetModule(2);
    global.__r(1);
    global.__r(2);

    expect(factory.mock.calls.map(([id]) => id)).toEqual([1, 2, 2]);
  });

  it('leaves __r and __resetModule untouched until the registry is created', async () => {
    const before = { r: global.__r, reset: global.__resetModule };

    await import('./install.js');
    const { createMockRegistry } = await import('./mock-registry.js');

    expect(global.__r).toBe(before.r);
    expect(global.__resetModule).toBe(before.reset);

    createMockRegistry();

    expect(global.__r).not.toBe(before.r);
    expect(global.__resetModule).not.toBe(before.reset);
  });

  it('patches only once and returns the same registry', async () => {
    const { createMockRegistry } = await import('./mock-registry.js');

    const first = createMockRegistry();
    const patchedRequire = global.__r;
    const patchedReset = global.__resetModule;

    expect(createMockRegistry()).toBe(first);
    expect(global.__r).toBe(patchedRequire);
    expect(global.__resetModule).toBe(patchedReset);
  });
});
