import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRunTargets } from '../targets.js';
import * as adb from '../adb.js';
import * as environment from '../environment.js';

describe('Android target discovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('installs adb and emulator only for discovery', async () => {
    const ensureAndroidAdbAvailable = vi
      .spyOn(environment, 'ensureAndroidAdbAvailable')
      .mockResolvedValue('/tmp/android-sdk');
    const ensureAndroidEmulatorAvailable = vi
      .spyOn(environment, 'ensureAndroidEmulatorAvailable')
      .mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getAvds').mockResolvedValue(['Pixel_8_API_35']);
    vi.spyOn(adb, 'getConnectedDevices').mockResolvedValue([
      {
        id: 'device-1',
        manufacturer: 'Google',
        model: 'Pixel 8',
      },
    ]);

    await expect(getRunTargets()).resolves.toEqual([
      {
        type: 'emulator',
        name: 'Pixel_8_API_35',
        platform: 'android',
        description: 'Android emulator',
        device: {
          name: 'Pixel_8_API_35',
        },
      },
      {
        type: 'physical',
        name: 'Google Pixel 8',
        platform: 'android',
        description: 'Physical device (device-1)',
        device: {
          manufacturer: 'Google',
          model: 'Pixel 8',
        },
      },
    ]);

    expect(ensureAndroidAdbAvailable).toHaveBeenCalledTimes(1);
    expect(ensureAndroidEmulatorAvailable).toHaveBeenCalledTimes(1);
  });
});
