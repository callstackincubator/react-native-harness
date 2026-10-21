import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAndroidProcessEnv } from '../environment.js';

const sdkRoot = path.join(os.tmpdir(), 'android-sdk');

describe('getAndroidProcessEnv', () => {
  it('preserves a user-provided ANDROID_AVD_HOME', () => {
    const avdHome = path.join(os.tmpdir(), 'custom-avd-home');
    const env = getAndroidProcessEnv({
      ANDROID_HOME: sdkRoot,
      ANDROID_AVD_HOME: avdHome,
      PATH: '',
    });

    expect(env.ANDROID_AVD_HOME).toBe(avdHome);
  });

  it('defaults ANDROID_AVD_HOME to ~/.android/avd when unset', () => {
    const env = getAndroidProcessEnv({ ANDROID_HOME: sdkRoot, PATH: '' });

    expect(env.ANDROID_AVD_HOME).toBe(
      path.join(os.homedir(), '.android', 'avd'),
    );
  });
});
