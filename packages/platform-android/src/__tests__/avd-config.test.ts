import { describe, expect, it } from 'vitest';
import {
  getNormalizedAvdCacheConfig,
  isAvdCompatible,
  parseAvdConfig,
  resolveAvdCachingEnabled,
} from '../avd-config.js';
import { AndroidPlatformConfigSchema } from '../config.js';

describe('AVD config helpers', () => {
  it('parses snapshot config from Android schema', () => {
    const config = AndroidPlatformConfigSchema.parse({
      name: 'android',
      bundleId: 'com.example.app',
      device: {
        type: 'emulator',
        name: 'Pixel_8_API_35',
        avd: {
          apiLevel: 35,
          profile: 'pixel_8',
          diskSize: '1G',
          heapSize: '512M',
          snapshot: {
            enabled: true,
          },
        },
      },
    });

    expect(config.device.type).toBe('emulator');
    if (config.device.type === 'emulator') {
      expect(config.device.avd?.snapshot?.enabled).toBe(true);
    }
  });

  it('lets HARNESS_AVD_CACHING override config before interactive gating', () => {
    expect(
      resolveAvdCachingEnabled({
        avd: {
          apiLevel: 35,
          profile: 'pixel_8',
          diskSize: '1G',
          heapSize: '1G',
          snapshot: { enabled: false },
        },
        isInteractive: false,
        env: {
          HARNESS_AVD_CACHING: 'true',
        },
      })
    ).toBe(true);
  });

  it('disables caching for interactive sessions even when requested', () => {
    expect(
      resolveAvdCachingEnabled({
        avd: {
          apiLevel: 35,
          profile: 'pixel_8',
          diskSize: '1G',
          heapSize: '1G',
          snapshot: { enabled: true },
        },
        isInteractive: true,
      })
    ).toBe(false);
  });

  it('parses config.ini and matches compatible AVD metadata', () => {
    const avdConfig = parseAvdConfig(`
image.sysdir.1=system-images/android-35/default/x86_64/
abi.type=x86_64
hw.device.name=pixel_8
disk.dataPartition.size=1G
vm.heapSize=512M
`);

    expect(
      isAvdCompatible({
        emulator: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: 'pixel_8',
            diskSize: '1G',
            heapSize: '512M',
          },
        },
        avdConfig,
        hostArch: 'x86_64',
      })
    ).toEqual({ compatible: true });
  });

  it('reports incompatibility when AVD metadata differs', () => {
    const avdConfig = parseAvdConfig(`
image.sysdir.1=system-images/android-34/default/x86_64/
abi.type=x86_64
hw.device.name=pixel_7
disk.dataPartition.size=2G
vm.heapSize=1G
`);

    expect(
      isAvdCompatible({
        emulator: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: 'pixel_8',
            diskSize: '1G',
            heapSize: '512M',
          },
        },
        avdConfig,
        hostArch: 'x86_64',
      })
    ).toMatchObject({
      compatible: false,
    });
  });

  it('normalizes AVD cache key input with name and host arch', () => {
    expect(
      getNormalizedAvdCacheConfig({
        emulator: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: ' Pixel_8 ',
            diskSize: '1G',
            heapSize: '512M',
          },
        },
        hostArch: 'arm64-v8a',
      })
    ).toEqual({
      name: 'Pixel_8_API_35',
      apiLevel: 35,
      arch: 'arm64-v8a',
      profile: 'pixel_8',
      diskSize: '1g',
      heapSize: '512m',
    });
  });
});
