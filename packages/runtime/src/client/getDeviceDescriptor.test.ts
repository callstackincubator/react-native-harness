import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeviceDescriptor } from './getDeviceDescriptor.js';

const mocks = vi.hoisted(() => ({
  Platform: {
    OS: 'ios' as string,
    constants: {} as Record<string, unknown>,
  },
}));

vi.mock('react-native', () => ({
  Platform: mocks.Platform,
}));

beforeEach(() => {
  mocks.Platform.OS = 'ios';
  mocks.Platform.constants = {};
});

describe('getDeviceDescriptor', () => {
  it('describes an iOS device', () => {
    mocks.Platform.OS = 'ios';
    mocks.Platform.constants = { osVersion: '17.4' };

    expect(getDeviceDescriptor()).toEqual({
      platform: 'ios',
      manufacturer: 'Apple',
      model: 'Unknown',
      osVersion: '17.4',
    });
  });

  it('describes an Android device', () => {
    mocks.Platform.OS = 'android';
    mocks.Platform.constants = {
      Manufacturer: 'Google',
      Model: 'Pixel 8',
      Release: '14',
    };

    expect(getDeviceDescriptor()).toEqual({
      platform: 'android',
      manufacturer: 'Google',
      model: 'Pixel 8',
      osVersion: '14',
    });
  });

  it('describes web', () => {
    mocks.Platform.OS = 'web';

    expect(getDeviceDescriptor()).toEqual({
      platform: 'web',
      manufacturer: '',
      model: '',
      osVersion: '',
    });
  });

  it('maps the kepler OS to the vega platform', () => {
    mocks.Platform.OS = 'kepler';

    expect(getDeviceDescriptor()).toEqual({
      platform: 'vega',
      manufacturer: '',
      model: '',
      osVersion: '',
    });
  });

  it('describes a Windows device', () => {
    mocks.Platform.OS = 'windows';
    mocks.Platform.constants = { osVersion: 10 };

    expect(getDeviceDescriptor()).toEqual({
      platform: 'windows',
      manufacturer: '',
      model: '',
      osVersion: '10',
    });
  });

  it('tolerates a Windows device without an osVersion constant', () => {
    mocks.Platform.OS = 'windows';
    mocks.Platform.constants = {};

    expect(getDeviceDescriptor().osVersion).toBe('');
  });

  it('throws for an unknown platform', () => {
    mocks.Platform.OS = 'tizen';

    expect(() => getDeviceDescriptor()).toThrow('Unsupported platform');
  });
});
