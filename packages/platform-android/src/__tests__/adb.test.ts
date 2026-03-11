import { describe, expect, it, vi } from 'vitest';
import { getAppUid, getLogcatTimestamp, getStartAppArgs } from '../adb.js';
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
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValueOnce({
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
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValueOnce({
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
});
