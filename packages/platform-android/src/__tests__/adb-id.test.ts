import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdbId, isAdbIdEmulator } from '../adb-id.js';
import * as adb from '../adb.js';

describe('adb id resolution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies emulator adb ids', () => {
    expect(isAdbIdEmulator('emulator-5554')).toBe(true);
    expect(isAdbIdEmulator('device-serial-001')).toBe(false);
  });

  it('skips non-emulator ids when resolving an emulator device', async () => {
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([
      'device-serial-001',
      'emulator-5554',
    ]);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Test_AVD_API_35');

    await expect(
      getAdbId({
        type: 'emulator',
        name: 'Test_AVD_API_35',
      }),
    ).resolves.toBe('emulator-5554');
  });

  it('resolves matching physical device by manufacturer and model', async () => {
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([
      'device-serial-001',
      'emulator-5554',
    ]);
    vi.spyOn(adb, 'getDeviceInfo').mockImplementation(async (adbId) => {
      const results: Record<string, { manufacturer: string; model: string }> = {
        'device-serial-001': { manufacturer: 'Acme', model: 'Model A1' },
        'emulator-5554': { manufacturer: 'Emulator', model: 'Emulator Model' },
      };
      return results[adbId] || null;
    });

    await expect(
      getAdbId({
        type: 'physical',
        manufacturer: 'acme',
        model: 'model a1',
      }),
    ).resolves.toBe('device-serial-001');
  });
});
