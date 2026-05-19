import type {
  HarnessPlatformInitOptions,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';

declare global {
  var __HARNESS_TEST_PLATFORM_RUNNER__:
    | HarnessPlatformRunner
    | undefined;
}

export default async function mockPlatformRunner(
  _platformConfig: Record<string, unknown>,
  _harnessConfig: HarnessConfig,
  _init: HarnessPlatformInitOptions,
): Promise<HarnessPlatformRunner> {
  if (!globalThis.__HARNESS_TEST_PLATFORM_RUNNER__) {
    throw new Error('Missing __HARNESS_TEST_PLATFORM_RUNNER__ test fixture');
  }

  return globalThis.__HARNESS_TEST_PLATFORM_RUNNER__;
}
