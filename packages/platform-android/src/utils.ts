import { isAndroidDeviceEmulator, type AndroidDevice } from './config.js';

export const getDeviceName = (device: AndroidDevice): string => {
  if (isAndroidDeviceEmulator(device)) {
    return `${device.name} (emulator)`;
  }

  return `${device.manufacturer} ${device.model}`;
};
