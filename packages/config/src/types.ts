import { z } from 'zod';

export const PlatformSchema = z.enum(['ios', 'android', 'web', 'vega']);

export const BrowserTypeSchema = z.enum(['chrome', 'firefox', 'safari']);

export const AndroidTestRunnerConfigSchema = z.object({
  name: z.string().min(1, 'Runner name is required'),
  platform: z.literal('android'),
  deviceId: z.string().min(1, 'Device ID is required'),
  bundleId: z.string().min(1, 'Bundle ID is required'),
  activityName: z
    .string()
    .min(1, 'Activity name is required')
    .default('.MainActivity'),
});

export const iOSTestRunnerConfigSchema = z.object({
  name: z.string().min(1, 'Runner name is required'),
  platform: z.literal('ios'),
  deviceId: z.string().min(1, 'Device ID is required'),
  bundleId: z.string().min(1, 'Bundle ID is required'),
  systemVersion: z.string().min(1, 'System version is required'),
});

export const WebTestRunnerConfigSchema = z.object({
  name: z.string().min(1, 'Runner name is required'),
  platform: z.literal('web'),
  browser: BrowserTypeSchema,
});

export const VegaTestRunnerConfigSchema = z.object({
  name: z.string().min(1, 'Runner name is required'),
  platform: z.literal('vega'),
  deviceId: z
    .string()
    .min(
      1,
      'Virtual device instance name is required (e.g., "VegaTV_1", "VegaTV_Debug")'
    ),
  bundleId: z
    .string()
    .min(1, 'Bundle ID is required (package identifier from manifest.toml)'),
  buildType: z.enum(['Debug', 'Release']).default('Release'),
  target: z.enum(['sim_tv_x86_64', 'sim_tv_aarch64']).default('sim_tv_x86_64'),
});

export const TestRunnerConfigSchema = z.discriminatedUnion('platform', [
  AndroidTestRunnerConfigSchema,
  iOSTestRunnerConfigSchema,
  WebTestRunnerConfigSchema,
  VegaTestRunnerConfigSchema,
]);

export const ConfigSchema = z
  .object({
    entryPoint: z.string().min(1, 'Entry point is required'),
    appRegistryComponentName: z
      .string()
      .min(1, 'App registry component name is required'),
    runners: z
      .array(TestRunnerConfigSchema)
      .min(1, 'At least one runner is required'),
    defaultRunner: z.string().optional(),
    bridgeTimeout: z
      .number()
      .min(1000, 'Bridge timeout must be at least 1 second')
      .default(60000),

    resetEnvironmentBetweenTestFiles: z.boolean().optional().default(true),
    unstable__skipAlreadyIncludedModules: z.boolean().optional().default(false),
  })
  .refine(
    (config) => {
      if (config.defaultRunner) {
        return config.runners.some(
          (runner) => runner.name === config.defaultRunner
        );
      }
      return true;
    },
    {
      message: 'Default runner must match one of the configured runner names',
      path: ['defaultRunner'],
    }
  );

export type Platform = z.infer<typeof PlatformSchema>;
export type BrowserType = z.infer<typeof BrowserTypeSchema>;
export type AndroidTestRunnerConfig = z.infer<
  typeof AndroidTestRunnerConfigSchema
>;
export type iOSTestRunnerConfig = z.infer<typeof iOSTestRunnerConfigSchema>;
export type WebTestRunnerConfig = z.infer<typeof WebTestRunnerConfigSchema>;
export type VegaTestRunnerConfig = z.infer<typeof VegaTestRunnerConfigSchema>;
export type TestRunnerConfig = z.infer<typeof TestRunnerConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function isIOSRunnerConfig(
  config: TestRunnerConfig
): config is iOSTestRunnerConfig {
  return config.platform === 'ios';
}

export function isAndroidRunnerConfig(
  config: TestRunnerConfig
): config is AndroidTestRunnerConfig {
  return config.platform === 'android';
}

export function isWebRunnerConfig(
  config: TestRunnerConfig
): config is WebTestRunnerConfig {
  return config.platform === 'web';
}

export function isVegaRunnerConfig(
  config: TestRunnerConfig
): config is VegaTestRunnerConfig {
  return config.platform === 'vega';
}

export function assertAndroidRunnerConfig(
  config: TestRunnerConfig
): asserts config is AndroidTestRunnerConfig {
  if (!isAndroidRunnerConfig(config)) {
    throw new Error(
      `Expected Android runner config but got platform: ${config.platform}`
    );
  }
}

export function assertIOSRunnerConfig(
  config: TestRunnerConfig
): asserts config is iOSTestRunnerConfig {
  if (!isIOSRunnerConfig(config)) {
    throw new Error(
      `Expected iOS runner config but got platform: ${config.platform}`
    );
  }
}
export function assertWebRunnerConfig(
  config: TestRunnerConfig
): asserts config is WebTestRunnerConfig {
  if (!isWebRunnerConfig(config)) {
    throw new Error(
      `Expected web runner config but got platform: ${config.platform}`
    );
  }
}

export function assertVegaRunnerConfig(
  config: TestRunnerConfig
): asserts config is VegaTestRunnerConfig {
  if (!isVegaRunnerConfig(config)) {
    throw new Error(
      `Expected Vega runner config but got platform: ${config.platform}`
    );
  }
}
