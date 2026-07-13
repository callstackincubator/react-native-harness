import { describe, expect, it } from 'vitest';
import {
  getEmulatorCpuCores,
  getEmulatorStartupArgs,
  isAccelerationUsable,
} from '../emulator-startup.js';
import { getDeviceCoreBudget } from '@react-native-harness/tools';
import os from 'node:os';

describe('getEmulatorCpuCores', () => {
  it('uses the shared device-core budget for the current host', () => {
    expect(getEmulatorCpuCores()).toBe(
      getDeviceCoreBudget(os.availableParallelism())
    );
  });
});

describe('emulator startup modes', () => {
  it('builds default boot args', () => {
    expect(getEmulatorStartupArgs('Pixel_8_API_35', 'default-boot')).toEqual(
      expect.arrayContaining([
        '@Pixel_8_API_35',
        '-no-snapshot-load',
        '-no-snapshot-save',
        '-no-metrics',
      ])
    );
    expect(
      getEmulatorStartupArgs('Pixel_8_API_35', 'default-boot')
    ).not.toEqual(expect.arrayContaining(['-camera-back', 'none']));
  });

  it('builds clean snapshot generation args', () => {
    expect(
      getEmulatorStartupArgs('Pixel_8_API_35', 'clean-snapshot-generation')
    ).toEqual(
      expect.arrayContaining([
        '@Pixel_8_API_35',
        '-no-snapshot-load',
        '-no-metrics',
      ])
    );
    expect(
      getEmulatorStartupArgs('Pixel_8_API_35', 'clean-snapshot-generation')
    ).not.toContain('-no-snapshot-save');
  });

  it('builds snapshot reuse args', () => {
    expect(getEmulatorStartupArgs('Pixel_8_API_35', 'snapshot-reuse')).toEqual(
      expect.arrayContaining([
        '@Pixel_8_API_35',
        '-no-snapshot-save',
        '-no-metrics',
      ])
    );
    expect(
      getEmulatorStartupArgs('Pixel_8_API_35', 'snapshot-reuse')
    ).not.toContain('-no-snapshot-load');
  });
});

describe('isAccelerationUsable', () => {
  it('returns true when the emulator reports acceleration is usable', () => {
    expect(
      isAccelerationUsable(
        'accel:\n0\nKVM (version 12) is installed and usable.\naccel\n'
      )
    ).toBe(true);
  });

  it('returns false when acceleration is disabled', () => {
    expect(
      isAccelerationUsable(
        'accel:\n0\nKVM is not installed on this machine.\naccel\n'
      )
    ).toBe(false);
  });

  it('returns false for empty output', () => {
    expect(isAccelerationUsable('')).toBe(false);
  });
});
