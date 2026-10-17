import { describe, expect, it } from 'vitest';

import { ApplePhysicalDeviceCodeSignSchema } from '../config.js';

const withPrefix = (bundleIdPrefix: string) =>
  ApplePhysicalDeviceCodeSignSchema.safeParse({
    bundleIdPrefix,
    teamId: 'TESTTEAM01',
  });

describe('device.codeSign.bundleIdPrefix', () => {
  it('is optional', () => {
    expect(
      ApplePhysicalDeviceCodeSignSchema.safeParse({ teamId: 'TESTTEAM01' })
        .success
    ).toBe(true);
  });

  it.each(['com.example', 'com.example.app', 'dev.chmal', 'a.b'])(
    'accepts the reverse-DNS prefix %s',
    (bundleIdPrefix) => {
      expect(withPrefix(bundleIdPrefix).success).toBe(true);
    }
  );

  // The prefix is pasted into bundle ids and signed into installed bundles, so a
  // value with spaces or path separators would produce an id that fails at
  // install time, far from the typo that caused it.
  it.each([
    'com example',
    'dev chmal.harness-agent',
    'com/example',
    'com.example..app',
    '.com.example',
    'com.example.',
    'com',
    '',
  ])('rejects the invalid prefix %s', (bundleIdPrefix) => {
    expect(withPrefix(bundleIdPrefix).success).toBe(false);
  });
});
