import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureAndroidAdbAvailable,
  ensureAndroidEmulatorAvailable,
  getAndroidSdkRoot,
  getAndroidSystemImagePackage,
  getDefaultUnixAndroidSdkRoot,
  getHostAndroidSystemImageArch,
  getRequiredAndroidSdkPackages,
} from '../environment.js';
import * as tools from '@react-native-harness/tools';

describe('Android environment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('skips bootstrapping command-line tools when adb is already installed', async () => {
    const sdkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'android-sdk-'));
    const adbPath = path.join(sdkRoot, 'platform-tools', 'adb');

    fs.mkdirSync(path.dirname(adbPath), { recursive: true });
    fs.writeFileSync(adbPath, '');

    const spawnSpy = vi.spyOn(tools, 'spawn');

    await expect(
      ensureAndroidAdbAvailable({
        env: { ANDROID_HOME: sdkRoot },
      }),
    ).resolves.toBe(sdkRoot);

    expect(spawnSpy).not.toHaveBeenCalled();

    fs.rmSync(sdkRoot, { force: true, recursive: true });
  });

  it('installs only platform-tools when adb is missing', async () => {
    const sdkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'android-sdk-'));
    const sdkManagerDirectory = path.join(
      sdkRoot,
      'cmdline-tools',
      'latest',
      'bin',
    );

    fs.mkdirSync(sdkManagerDirectory, { recursive: true });
    fs.writeFileSync(path.join(sdkManagerDirectory, 'sdkmanager'), '');
    fs.writeFileSync(path.join(sdkManagerDirectory, 'avdmanager'), '');

    const spawnSpy = vi.spyOn(tools, 'spawn').mockImplementation((async (
      command: string,
      args?: readonly string[],
    ) => {
      if (command === 'bash' && typeof args?.[1] === 'string') {
        const commandString = args[1];

        if (commandString.includes('platform-tools')) {
          const adbPath = path.join(sdkRoot, 'platform-tools', 'adb');
          fs.mkdirSync(path.dirname(adbPath), { recursive: true });
          fs.writeFileSync(adbPath, '');
        }
      }

      return {} as Awaited<ReturnType<typeof tools.spawn>>;
    }) as typeof tools.spawn);

    await expect(
      ensureAndroidAdbAvailable({
        env: { ANDROID_HOME: sdkRoot },
      }),
    ).resolves.toBe(sdkRoot);

    expect(spawnSpy).toHaveBeenCalledWith(
      'bash',
      ['-lc', expect.stringContaining('platform-tools')],
      expect.any(Object),
    );
    expect(
      spawnSpy.mock.calls.some(
        ([command, args]) =>
          command === 'bash' &&
          typeof args?.[1] === 'string' &&
          args[1].includes('platform-tools') &&
          args[1].includes('emulator'),
      ),
    ).toBe(false);

    fs.rmSync(sdkRoot, { force: true, recursive: true });
  });

  it('installs emulator only when emulator is missing', async () => {
    const sdkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'android-sdk-'));
    const sdkManagerDirectory = path.join(
      sdkRoot,
      'cmdline-tools',
      'latest',
      'bin',
    );

    fs.mkdirSync(sdkManagerDirectory, { recursive: true });
    fs.writeFileSync(path.join(sdkManagerDirectory, 'sdkmanager'), '');
    fs.writeFileSync(path.join(sdkManagerDirectory, 'avdmanager'), '');

    const spawnSpy = vi.spyOn(tools, 'spawn').mockImplementation((async (
      command: string,
      args?: readonly string[],
    ) => {
      if (command === 'bash' && typeof args?.[1] === 'string') {
        const commandString = args[1];

        if (commandString.includes('emulator')) {
          const emulatorPath = path.join(sdkRoot, 'emulator', 'emulator');
          fs.mkdirSync(path.dirname(emulatorPath), { recursive: true });
          fs.writeFileSync(emulatorPath, '');
        }
      }

      return {} as Awaited<ReturnType<typeof tools.spawn>>;
    }) as typeof tools.spawn);

    await expect(
      ensureAndroidEmulatorAvailable({
        env: { ANDROID_HOME: sdkRoot },
      }),
    ).resolves.toBe(sdkRoot);

    expect(spawnSpy).toHaveBeenCalledWith(
      'bash',
      ['-lc', expect.stringContaining('emulator')],
      expect.any(Object),
    );

    fs.rmSync(sdkRoot, { force: true, recursive: true });
  });

  it('uses the default Unix SDK root when env vars are missing', () => {
    expect(
      getDefaultUnixAndroidSdkRoot({
        platform: 'darwin',
        homeDirectory: '/Users/tester',
      }),
    ).toBe('/Users/tester/Library/Android/sdk');

    expect(
      getAndroidSdkRoot(
        {},
        {
          platform: 'linux',
          homeDirectory: '/home/tester',
        },
      ),
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
        },
      ),
    ).toBe('/env/android-home');

    expect(
      getAndroidSdkRoot(
        {
          ANDROID_SDK_ROOT: '/env/android-sdk-root',
        },
        {
          platform: 'linux',
          homeDirectory: '/home/tester',
        },
      ),
    ).toBe('/env/android-sdk-root');
  });

  it('selects Android packages using the host architecture', () => {
    expect(getHostAndroidSystemImageArch('x64')).toBe('x86_64');
    expect(getHostAndroidSystemImageArch('arm64')).toBe('arm64-v8a');
    expect(getAndroidSystemImagePackage(35, 'x86_64')).toBe(
      'system-images;android-35;default;x86_64',
    );
    expect(getAndroidSystemImagePackage(35, 'arm64-v8a')).toBe(
      'system-images;android-35;default;arm64-v8a',
    );
  });

  it('derives emulator package requirements from runner config fields', () => {
    expect(
      getRequiredAndroidSdkPackages({
        apiLevel: 34,
        includeEmulator: true,
        architecture: 'x86_64',
      }),
    ).toEqual([
      'platform-tools',
      'emulator',
      'platforms;android-34',
      'system-images;android-34;default;x86_64',
    ]);
  });
});
