import { describe, expect, it } from 'vitest';
import {
  getDeviceConnectionHost,
  getDeviceCtlLaunchArgs,
  isMatchingDevice,
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

  it('matches physical devices by name, CoreDevice identifier, or hardware UDID', () => {
    const device = {
      identifier: '6954F636-D116-52FA-9D00-8298BBB63705',
      deviceProperties: {
        name: 'G22RJQXC3V',
        osVersionNumber: '26.0',
      },
      hardwareProperties: {
        marketingName: 'iPhone',
        productType: 'iPhone17,1',
        udid: '00008140-001600222422201C',
      },
    };
    const matchesName = isMatchingDevice(device, 'G22RJQXC3V');
    const matchesIdentifier = isMatchingDevice(
      device,
      '6954F636-D116-52FA-9D00-8298BBB63705'
    );
    const matchesUdid = isMatchingDevice(device, '00008140-001600222422201C');
    const matchesUnknownName = isMatchingDevice(device, 'Unknown iPhone');

    expect(matchesName).toBe(true);
    expect(matchesIdentifier).toBe(true);
    expect(matchesUdid).toBe(true);
    expect(matchesUnknownName).toBe(false);
  });
});
