import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSkipAlreadyIncludedModules } from '../types.js';

describe('resolveSkipAlreadyIncludedModules', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to true when neither the new flag nor the alias is set', () => {
    expect(
      resolveSkipAlreadyIncludedModules({
        skipAlreadyIncludedModules: undefined,
        unstable__skipAlreadyIncludedModules: undefined,
      })
    ).toBe(true);
  });

  it('uses the deprecated alias when only it is set', () => {
    expect(
      resolveSkipAlreadyIncludedModules({
        skipAlreadyIncludedModules: undefined,
        unstable__skipAlreadyIncludedModules: false,
      })
    ).toBe(false);

    expect(
      resolveSkipAlreadyIncludedModules({
        skipAlreadyIncludedModules: undefined,
        unstable__skipAlreadyIncludedModules: true,
      })
    ).toBe(true);
  });

  it('logs a deprecation warning when the alias is set', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    resolveSkipAlreadyIncludedModules({
      skipAlreadyIncludedModules: undefined,
      unstable__skipAlreadyIncludedModules: false,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      'unstable__skipAlreadyIncludedModules'
    );
  });

  it('does not log a deprecation warning when only the new flag is set', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    resolveSkipAlreadyIncludedModules({
      skipAlreadyIncludedModules: false,
      unstable__skipAlreadyIncludedModules: undefined,
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('lets the explicit new flag win over the alias in either direction', () => {
    expect(
      resolveSkipAlreadyIncludedModules({
        skipAlreadyIncludedModules: false,
        unstable__skipAlreadyIncludedModules: true,
      })
    ).toBe(false);

    expect(
      resolveSkipAlreadyIncludedModules({
        skipAlreadyIncludedModules: true,
        unstable__skipAlreadyIncludedModules: false,
      })
    ).toBe(true);
  });
});
