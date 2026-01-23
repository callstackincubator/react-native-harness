import { Platform, PlatformConstants, PlatformStatic } from 'react-native';

interface PlatformKeplerStatic extends PlatformStatic {
  constants: PlatformConstants;
  OS: 'kepler';
  Version: number;
}

const getPlatform = (): Platform | PlatformKeplerStatic => {
  return Platform as Platform | PlatformKeplerStatic;
};

export type DeviceDescriptor = {
  platform: 'ios' | 'android' | 'vega' | 'web';
  manufacturer: string;
  model: string;
  osVersion: string;
};

export const getDeviceDescriptor = (): DeviceDescriptor => {
  const platform = getPlatform();

  if (platform.OS === 'web') {
    return {
      platform: 'web',
      manufacturer: '',
      model: '',
      osVersion: '',
    };
  }

  if (platform.OS === 'ios') {
    return {
      platform: 'ios',
      manufacturer: 'Apple',
      model: 'Unknown',
      osVersion: platform.constants.osVersion,
    };
  }

  if (platform.OS === 'android') {
    return {
      platform: 'android',
      manufacturer: platform.constants.Manufacturer,
      model: platform.constants.Model,
      osVersion: platform.constants.Release,
    };
  }

  if (platform.OS === 'kepler') {
    return {
      platform: 'vega',
      manufacturer: '',
      model: '',
      osVersion: '',
    };
  }

  throw new Error('Unsupported platform');
};
