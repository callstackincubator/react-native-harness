import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('installed seams', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws a clear error when no module system is installed', async () => {
    const { getModuleSystem } = await import('./module-system.js');

    expect(() => getModuleSystem()).toThrow(/No module system is installed/);
  });

  it('throws a clear error when no host is installed', async () => {
    const { getHost } = await import('./host.js');

    expect(() => getHost()).toThrow(/No host is installed/);
  });

  it('returns what was installed', async () => {
    const { getModuleSystem, installModuleSystem } = await import(
      './module-system.js'
    );
    const { getHost, installHost } = await import('./host.js');
    const moduleSystem = {} as ReturnType<typeof getModuleSystem>;
    const host = {} as ReturnType<typeof getHost>;

    installModuleSystem(moduleSystem);
    installHost(host);

    expect(getModuleSystem()).toBe(moduleSystem);
    expect(getHost()).toBe(host);
  });

  it('creates the mock registry from the installed module system when the mocker is first evaluated', async () => {
    const { installModuleSystem } = await import('./module-system.js');
    const registry = {
      mock: vi.fn(),
      unmock: vi.fn(),
      requireActual: vi.fn(),
      resetModules: vi.fn(),
    };
    const createMockRegistry = vi.fn(() => registry);
    installModuleSystem({ createMockRegistry } as never);

    expect(createMockRegistry).not.toHaveBeenCalled();

    const mocker = await import('./mocker/index.js');

    expect(createMockRegistry).toHaveBeenCalledTimes(1);
    expect(mocker.mock).toBe(registry.mock);
    expect(mocker.resetModules).toBe(registry.resetModules);
  });
});
