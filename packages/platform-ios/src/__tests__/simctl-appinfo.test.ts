import { afterEach, describe, expect, it, vi } from 'vitest';
import * as tools from '@react-native-harness/tools';
import { getAppInfo, isAppInstalled } from '../xcrun/simctl.js';

const UDID = 'sim-udid';
const BUNDLE_ID = 'com.example.app';
const APP_INFO = {
  Bundle: '/Applications/Example.app',
  CFBundleIdentifier: BUNDLE_ID,
  CFBundleExecutable: 'Example',
  CFBundleName: 'Example',
  CFBundleDisplayName: 'Example',
  Path: '/Applications/Example.app',
};

const result = (stdout: string) =>
  ({ stdout } as Awaited<ReturnType<typeof tools.spawn>>);

const subprocessError = (exitCode: number) =>
  Object.assign(Object.create(tools.SubprocessError.prototype), { exitCode });

const mockAppInfo = (info: Record<string, unknown>) =>
  vi
    .spyOn(tools, 'spawn')
    .mockResolvedValueOnce(result('app-info-plist'))
    .mockResolvedValueOnce(result(JSON.stringify(info)));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAppInfo', () => {
  it('returns the installed app information', async () => {
    const spawn = mockAppInfo(APP_INFO);

    await expect(getAppInfo(UDID, BUNDLE_ID)).resolves.toEqual(APP_INFO);
    expect(spawn).toHaveBeenNthCalledWith(1, 'xcrun', [
      'simctl',
      'appinfo',
      UDID,
      BUNDLE_ID,
    ]);
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'plutil',
      ['-convert', 'json', '-o', '-', '-'],
      { stdin: { string: 'app-info-plist' } }
    );
  });

  it('returns null for a successful one-entry response', async () => {
    mockAppInfo({ CFBundleIdentifier: BUNDLE_ID });

    await expect(getAppInfo(UDID, BUNDLE_ID)).resolves.toBeNull();
  });

  it.each([
    ['an invalid device', 148],
    ['a shut-down device', 149],
    ['an invalid argument', 22],
  ])(
    'propagates the subprocess error for %s',
    async (_description, exitCode) => {
      const error = subprocessError(exitCode);
      const spawn = vi.spyOn(tools, 'spawn').mockRejectedValueOnce(error);

      await expect(getAppInfo(UDID, BUNDLE_ID)).rejects.toBe(error);
      expect(spawn).toHaveBeenCalledTimes(1);
    }
  );

  it('propagates non-subprocess errors even if they have exitCode 3', async () => {
    const error = Object.assign(new Error('appinfo failed'), { exitCode: 3 });
    vi.spyOn(tools, 'spawn').mockRejectedValueOnce(error);

    await expect(getAppInfo(UDID, BUNDLE_ID)).rejects.toBe(error);
  });

  it('propagates plist conversion errors, including exit code 3', async () => {
    const error = subprocessError(3);
    vi.spyOn(tools, 'spawn')
      .mockResolvedValueOnce(result('invalid-plist'))
      .mockRejectedValueOnce(error);

    await expect(getAppInfo(UDID, BUNDLE_ID)).rejects.toBe(error);
  });

  it('propagates invalid JSON from the plist converter', async () => {
    vi.spyOn(tools, 'spawn')
      .mockResolvedValueOnce(result('app-info-plist'))
      .mockResolvedValueOnce(result('invalid-json'));

    await expect(getAppInfo(UDID, BUNDLE_ID)).rejects.toBeInstanceOf(
      SyntaxError
    );
  });
});

describe('isAppInstalled', () => {
  it('returns true for an installed app', async () => {
    mockAppInfo(APP_INFO);

    await expect(isAppInstalled(UDID, BUNDLE_ID)).resolves.toBe(true);
  });

  it('returns false for a successful one-entry response', async () => {
    mockAppInfo({ CFBundleIdentifier: BUNDLE_ID });

    await expect(isAppInstalled(UDID, BUNDLE_ID)).resolves.toBe(false);
  });

  it('propagates lookup failures instead of reporting a missing app', async () => {
    const error = subprocessError(148);
    vi.spyOn(tools, 'spawn').mockRejectedValueOnce(error);

    await expect(isAppInstalled(UDID, BUNDLE_ID)).rejects.toBe(error);
  });
});
