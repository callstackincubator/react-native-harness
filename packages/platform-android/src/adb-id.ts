import * as adb from './adb.js';
import {
  isAndroidDeviceEmulator,
  isAndroidDevicePhysical,
  AndroidDevice,
} from './config.js';

export const isAdbIdEmulator = (adbId: string): boolean => {
  return adbId.startsWith('emulator-');
};

export const getAdbId = async (
  device: AndroidDevice
): Promise<string | null> => {
  const adbIds = await adb.getDeviceIds();

  for (const adbId of adbIds) {
    if (isAndroidDeviceEmulator(device)) {
      const emulatorName = await adb.getEmulatorName(adbId);

      if (emulatorName === device.name) {
        return adbId;
      }
    } else if (isAndroidDevicePhysical(device)) {
      const deviceInfo = await adb.getDeviceInfo(adbId);
      if (
        deviceInfo?.manufacturer === device.manufacturer &&
        deviceInfo?.model === device.model
      ) {
        return adbId;
      }
    }
  }

  return null;
};
