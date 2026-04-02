import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAndroidSdkRoot,
  getAndroidSystemImagePackage,
  getDefaultUnixAndroidSdkRoot,
  getHostAndroidSystemImageArch,
  getRequiredAndroidSdkPackages,
} from '../environment.js';

describe('Android environment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses the default Unix SDK root when env vars are missing', () => {
    expect(
      getDefaultUnixAndroidSdkRoot({
        platform: 'darwin',
        homeDirectory: '/Users/tester',
      })
    ).toBe('/Users/tester/Library/Android/sdk');

    expect(
      getAndroidSdkRoot(
        {},
        {
          platform: 'linux',
          homeDirectory: '/home/tester',
        }
      )
    ).toBe('/home/tester/Android/Sdk');
  });

  it('prefers ANDROID_HOME and ANDROID_SDK_ROOT over default paths', () => {
    expect(
      getAndroidSdkRoot(
        {
          ANDROID_HOME: '/env/android-home',
          ANDROID_SDK_ROOT: '/env/android-sdk-root',
        },
        {
          platform: 'darwin',
          homeDirectory: '/Users/tester',
        }
      )
    ).toBe('/env/android-home');

    expect(
      getAndroidSdkRoot(
        {
          ANDROID_SDK_ROOT: '/env/android-sdk-root',
        },
        {
          platform: 'linux',
          homeDirectory: '/home/tester',
        }
      )
    ).toBe('/env/android-sdk-root');
  });

  it('selects Android packages using the host architecture', () => {
    expect(getHostAndroidSystemImageArch('x64')).toBe('x86_64');
    expect(getHostAndroidSystemImageArch('arm64')).toBe('arm64-v8a');
    expect(getAndroidSystemImagePackage(35, 'x86_64')).toBe(
      'system-images;android-35;default;x86_64'
    );
    expect(getAndroidSystemImagePackage(35, 'arm64-v8a')).toBe(
      'system-images;android-35;default;arm64-v8a'
    );
  });

  it('derives emulator package requirements from runner config fields', () => {
    expect(
      getRequiredAndroidSdkPackages({
        apiLevel: 34,
        includeEmulator: true,
        architecture: 'x86_64',
      })
    ).toEqual([
      'platform-tools',
      'emulator',
      'platforms;android-34',
      'system-images;android-34;default;x86_64',
    ]);
  });
});
