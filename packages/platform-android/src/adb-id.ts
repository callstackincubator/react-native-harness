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

      if (!deviceInfo) {
        // This should never happen as we already checked if the device is physical.
        return null;
      }

      const normalizedManufacturer = deviceInfo.manufacturer?.toLowerCase() ?? '';
      const normalizedModel = deviceInfo.model?.toLowerCase() ?? '';

      if (
        normalizedManufacturer === device.manufacturer &&
        normalizedModel === device.model
      ) {
        return adbId;
      }
    }
  }

  return null;
};
