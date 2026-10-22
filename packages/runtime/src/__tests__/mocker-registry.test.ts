import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    await import('../mocker/registry.js');

    global.__r(7);
    global.__r(7);
    expect(factory).toHaveBeenCalledTimes(1);

    global.__resetModule(7);
    global.__r(7);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(metroReset).toHaveBeenCalledWith(7);
  });

  it('keeps other modules cached when one is reset', async () => {
    await import('../mocker/registry.js');

    global.__r(1);
    global.__r(2);
    global.__resetModule(2);
    global.__r(1);
    global.__r(2);

    expect(factory.mock.calls.map(([id]) => id)).toEqual([1, 2, 2]);
  });
});
