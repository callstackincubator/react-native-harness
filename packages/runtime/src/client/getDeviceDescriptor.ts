import { Platform } from 'react-native';

export type DeviceDescriptor = {
  platform: 'ios' | 'android';
  manufacturer: string;
  model: string;
  osVersion: string;
};

export const getDeviceDescriptor = (): DeviceDescriptor => {
  if (Platform.OS === 'ios') {
    return {
      platform: 'ios',
      manufacturer: 'Apple',
      model: 'Unknown',
      osVersion: Platform.constants.osVersion,
    };
  }

  if (Platform.OS === 'android') {
    return {
      platform: 'android',
      manufacturer: Platform.constants.Manufacturer,
      model: Platform.constants.Model,
      osVersion: Platform.constants.Release,
    };
  }

  throw new Error('Unsupported platform');
};
