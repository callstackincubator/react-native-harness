import { describe, expect, it } from 'vitest';
import {
  getDeviceConnectionHost,
  getDeviceCtlLaunchArgs,
} from '../xcrun/devicectl.js';
import { getSimctlChildEnvironment } from '../xcrun/simctl.js';

describe('Apple app launch options', () => {
  it('maps simulator environment to SIMCTL_CHILD variables', () => {
    expect(
      getSimctlChildEnvironment({
        environment: {
          FEATURE_X: '1',
          HARNESS_MODE: 'startup',
        },
      })
    ).toEqual({
      SIMCTL_CHILD_FEATURE_X: '1',
      SIMCTL_CHILD_HARNESS_MODE: 'startup',
    });
  });

  it('maps device arguments and environment to devicectl launch args', () => {
    expect(
      getDeviceCtlLaunchArgs('device-id', 'com.example.app', {
        arguments: ['--mode=test', '--retry=1'],
        environment: {
          FEATURE_X: '1',
        },
      })
    ).toEqual([
      'process',
      'launch',
      '--device',
      'device-id',
      '--environment-variables',
      '{"FEATURE_X":"1"}',
      'com.example.app',
      '--',
      '--mode=test',
      '--retry=1',
    ]);
  });

  it('uses the CoreDevice tunnel IP as the direct device connection host', () => {
    expect(
      getDeviceConnectionHost({
        identifier: 'device-id',
        connectionProperties: {
          tunnelIPAddress: 'fd12:3456:789a::1',
          potentialHostnames: ['my-iphone.local'],
        },
        deviceProperties: {
          name: 'My iPhone',
          osVersionNumber: '18.0',
        },
        hardwareProperties: {
          marketingName: 'iPhone',
          productType: 'iPhone17,1',
          udid: '00008140-001600222422201C',
        },
      })
    ).toBe('fd12:3456:789a::1');
  });
});
