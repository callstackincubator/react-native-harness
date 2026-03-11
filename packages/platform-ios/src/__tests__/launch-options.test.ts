import { describe, expect, it } from 'vitest';
import {
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
      '--mode=test',
      '--retry=1',
    ]);
  });
});
