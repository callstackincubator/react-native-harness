import { isAppleDeviceSimulator, type AppleDevice } from './config.js';

export const getDeviceName = (device: AppleDevice): string => {
  if (isAppleDeviceSimulator(device)) {
    return `${device.name} (${device.systemVersion}) (simulator)`;
  }

  return `${device.name} (physical)`;
};
