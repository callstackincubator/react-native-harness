import { describe, expect, it } from 'vitest';
import {
  createPlatformSkippedTestResult,
  getHarnessTestFilePlatform,
  shouldRunHarnessTestFile,
} from '../test-file-platform-filter.js';

const knownPlatformIds = new Set(['android', 'ios', 'web', 'vega']);

describe('getHarnessTestFilePlatform', () => {
  it('returns null for shared harness test files', () => {
    expect(getHarnessTestFilePlatform('/tests/smoke.harness.ts', knownPlatformIds)).toBeNull();
    expect(getHarnessTestFilePlatform('/tests/smoke.harness.tsx', knownPlatformIds)).toBeNull();
    expect(getHarnessTestFilePlatform('/tests/smoke.harness.mjs', knownPlatformIds)).toBeNull();
  });

  it('returns the platform id for platform-specific harness test files', () => {
    expect(
      getHarnessTestFilePlatform('/tests/kotlin.android.harness.ts', knownPlatformIds),
    ).toBe('android');
    expect(
      getHarnessTestFilePlatform('/tests/swift.ios.harness.ts', knownPlatformIds),
    ).toBe('ios');
    expect(
      getHarnessTestFilePlatform('/tests/browser.web.harness.ts', knownPlatformIds),
    ).toBe('web');
  });

  it('returns null when the segment before .harness is not a known platform id', () => {
    expect(
      getHarnessTestFilePlatform('/tests/smoke.harness.ts', knownPlatformIds),
    ).toBeNull();
    expect(
      getHarnessTestFilePlatform('/tests/custom.foo.harness.ts', knownPlatformIds),
    ).toBeNull();
  });
});

describe('shouldRunHarnessTestFile', () => {
  it('runs shared harness test files on every platform', () => {
    expect(
      shouldRunHarnessTestFile('/tests/smoke.harness.ts', 'android', knownPlatformIds),
    ).toBe(true);
    expect(
      shouldRunHarnessTestFile('/tests/smoke.harness.ts', 'ios', knownPlatformIds),
    ).toBe(true);
  });

  it('runs platform-specific files only on the matching platform', () => {
    expect(
      shouldRunHarnessTestFile('/tests/kotlin.android.harness.ts', 'android', knownPlatformIds),
    ).toBe(true);
    expect(
      shouldRunHarnessTestFile('/tests/kotlin.android.harness.ts', 'ios', knownPlatformIds),
    ).toBe(false);
    expect(
      shouldRunHarnessTestFile('/tests/swift.ios.harness.ts', 'ios', knownPlatformIds),
    ).toBe(true);
    expect(
      shouldRunHarnessTestFile('/tests/swift.ios.harness.ts', 'android', knownPlatformIds),
    ).toBe(false);
  });
});

describe('createPlatformSkippedTestResult', () => {
  it('marks the entire test file as skipped', () => {
    const result = createPlatformSkippedTestResult('/tests/swift.ios.harness.ts');

    expect(result.skipped).toBe(true);
    expect(result.numPassingTests).toBe(0);
    expect(result.numFailingTests).toBe(0);
    expect(result.numPendingTests).toBe(1);
    expect(result.testResults).toHaveLength(1);
    expect(result.testResults[0]).toEqual(
      expect.objectContaining({
        status: 'skipped',
        title: 'swift.ios.harness.ts',
        fullName: 'swift.ios.harness.ts',
      }),
    );
    expect(result.testFilePath).toBe('/tests/swift.ios.harness.ts');
  });
});
