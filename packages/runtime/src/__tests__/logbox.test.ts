import { beforeEach, describe, expect, it, vi } from 'vitest';

const importLogBox = async () => {
  vi.resetModules();
  return await import('../logbox.js');
};

describe('disableLogBoxUI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('react-native');
  });

  it('does not require TurboModuleRegistry on web', async () => {
    const ignoreAllLogs = vi.fn();

    vi.doMock('react-native', () => ({
      LogBox: {
        ignoreAllLogs,
      },
      TurboModuleRegistry: undefined,
    }));

    const { disableLogBoxUI, isLogBoxSuppressed } = await importLogBox();

    expect(() => disableLogBoxUI()).not.toThrow();
    expect(ignoreAllLogs).toHaveBeenCalledWith(true);
    expect(isLogBoxSuppressed()).toBe(true);
  });

  it('hides the native LogBox module when available', async () => {
    const nativeLogBox = {
      show: vi.fn(),
      hide: vi.fn(),
    };

    vi.doMock('react-native', () => ({
      LogBox: {
        ignoreAllLogs: vi.fn(),
      },
      TurboModuleRegistry: {
        get: vi.fn(() => nativeLogBox),
      },
    }));

    const { disableLogBoxUI } = await importLogBox();

    disableLogBoxUI();

    expect(nativeLogBox.show()).toBeUndefined();
    expect(nativeLogBox.hide()).toBeUndefined();
  });
});
