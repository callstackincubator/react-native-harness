import { describe, expect, it } from 'vitest';
import { getEmulatorStartupArgs } from '../emulator-startup.js';

describe('emulator startup modes', () => {
  it('builds default boot args', () => {
    expect(getEmulatorStartupArgs('Pixel_8_API_35', 'default-boot')).toEqual(
      expect.arrayContaining([
        '@Pixel_8_API_35',
        '-no-snapshot-load',
        '-no-snapshot-save',
      ])
    );
    expect(getEmulatorStartupArgs('Pixel_8_API_35', 'default-boot')).not.toEqual(
      expect.arrayContaining(['-camera-back', 'none'])
    );
  });

  it('builds clean snapshot generation args', () => {
    expect(
      getEmulatorStartupArgs('Pixel_8_API_35', 'clean-snapshot-generation')
    ).toEqual(expect.arrayContaining(['@Pixel_8_API_35', '-no-snapshot-load']));
    expect(
      getEmulatorStartupArgs('Pixel_8_API_35', 'clean-snapshot-generation')
    ).not.toContain('-no-snapshot-save');
  });

  it('builds snapshot reuse args', () => {
    expect(getEmulatorStartupArgs('Pixel_8_API_35', 'snapshot-reuse')).toEqual(
      expect.arrayContaining(['@Pixel_8_API_35', '-no-snapshot-save'])
    );
    expect(
      getEmulatorStartupArgs('Pixel_8_API_35', 'snapshot-reuse')
    ).not.toContain('-no-snapshot-load');
  });
});
