import { describe, expect, it, vi } from 'vitest';
import {
  createAvd,
  getAppUid,
  getLogcatTimestamp,
  getStartAppArgs,
  hasAvd,
  installApp,
} from '../adb.js';
import * as tools from '@react-native-harness/tools';

describe('getStartAppArgs', () => {
  it('maps supported extras to adb am start flags', () => {
    expect(
      getStartAppArgs('com.example.app', '.MainActivity', {
        extras: {
          feature_flag: true,
          user_id: 42,
          mode: 'debug',
        },
      })
    ).toEqual([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      '-n',
      'com.example.app/.MainActivity',
      '--ez',
      'feature_flag',
      'true',
      '--ei',
      'user_id',
      '42',
      '--es',
      'mode',
      'debug',
    ]);
  });

  it('rejects unsafe integer extras', () => {
    expect(() =>
      getStartAppArgs('com.example.app', '.MainActivity', {
        extras: {
          count: Number.MAX_SAFE_INTEGER + 1,
        },
      })
    ).toThrow('must be a safe integer');
  });

  it('extracts app uid from pm list packages output', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn').mockResolvedValueOnce({
      stdout:
        'package:com.other.app uid:10123\npackage:com.example.app uid:10234\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(getAppUid('emulator-5554', 'com.example.app')).resolves.toBe(
      10234
    );

    expect(spawnSpy).toHaveBeenCalledWith('adb', [
      '-s',
      'emulator-5554',
      'shell',
      'pm',
      'list',
      'packages',
      '-U',
    ]);
  });

  it('reads the device timestamp in logcat format', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn').mockResolvedValueOnce({
      stdout: "'03-12 11:35:08.000'\n",
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(getLogcatTimestamp('emulator-5554')).resolves.toBe(
      '03-12 11:35:08.000'
    );

    expect(spawnSpy).toHaveBeenCalledWith('adb', [
      '-s',
      'emulator-5554',
      'shell',
      'date',
      "+'%m-%d %H:%M:%S.000'",
    ]);
  });

  it('checks whether an AVD exists', async () => {
    vi.spyOn(tools, 'spawn').mockResolvedValueOnce({
      stdout: 'Pixel_6_API_33\nPixel_8_API_35\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(hasAvd('Pixel_8_API_35')).resolves.toBe(true);
    await expect(hasAvd('Missing_AVD')).resolves.toBe(false);
  });

  it('installs the app via adb', async () => {
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof tools.spawn>>);

    await installApp('emulator-5554', '/tmp/app.apk');

    expect(spawnSpy).toHaveBeenCalledWith('adb', [
      '-s',
      'emulator-5554',
      'install',
      '-r',
      '/tmp/app.apk',
    ]);
  });

  it('creates an AVD and appends config overrides', async () => {
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValue({} as Awaited<ReturnType<typeof tools.spawn>>);

    await createAvd({
      name: 'Pixel_8_API_35',
      apiLevel: 35,
      profile: 'pixel_8',
      diskSize: '1G',
      heapSize: '1G',
    });

    expect(spawnSpy).toHaveBeenNthCalledWith(1, 'sdkmanager', [
      'system-images;android-35;default;x86_64',
    ]);
    expect(spawnSpy).toHaveBeenNthCalledWith(2, 'bash', [
      '-lc',
      `printf 'no\n' | avdmanager create avd --force --name "Pixel_8_API_35" --package "system-images;android-35;default;x86_64" --device "pixel_8"`,
    ]);
    expect(spawnSpy).toHaveBeenNthCalledWith(3, 'bash', [
      '-lc',
      `printf '%s\n%s\n' 'disk.dataPartition.size=1G' 'vm.heapSize=1G' >> "$HOME/.android/avd/Pixel_8_API_35.avd/config.ini"`,
    ]);
  });
});
