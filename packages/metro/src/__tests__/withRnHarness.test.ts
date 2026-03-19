import { afterEach, describe, expect, it, vi } from 'vitest';

const consoleWarnSpy = vi
  .spyOn(console, 'warn')
  .mockImplementation(() => undefined);

afterEach(() => {
  consoleWarnSpy.mockClear();
  vi.resetModules();
});

describe('withRnHarness', () => {
  it('returns the provided config unchanged', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');
    const config = { resolver: { blockList: [] } };

    await expect(withRnHarness(config)()).resolves.toBe(config);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it('warns only once across repeated calls', async () => {
    const { withRnHarness } = await import('../withRnHarness.js');

    await withRnHarness({ projectRoot: '/tmp/app' }, true)();
    await withRnHarness(Promise.resolve({ projectRoot: '/tmp/app' }), true)();

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toContain(
      'Remove `withRnHarness` from your Metro config'
    );
  });
});
