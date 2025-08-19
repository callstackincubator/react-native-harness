import { z } from 'zod';

export const PlatformSchema = z.enum(['ios', 'android', 'web']);

export const ReporterSchema = z.object({
  report: z.function().args(z.array(z.any())).returns(z.promise(z.void())),
});

export const BrowserTypeSchema = z.enum(['chrome', 'firefox', 'safari']);

export const NativeTestRunnerConfigSchema = z.object({
  name: z.string().min(1, 'Runner name is required'),
  platform: z.enum(['ios', 'android']),
  deviceId: z.string().min(1, 'Device ID is required'),
  bundleId: z.string().min(1, 'Bundle ID is required'),
});

export const WebTestRunnerConfigSchema = z.object({
  name: z.string().min(1, 'Runner name is required'),
  platform: z.literal('web'),
  browser: BrowserTypeSchema,
});

export const TestRunnerConfigSchema = z.discriminatedUnion('platform', [
  NativeTestRunnerConfigSchema,
  WebTestRunnerConfigSchema,
]);

export const ConfigSchema = z
  .object({
    include: z.union([z.string(), z.array(z.string())]).refine(
      (val) => {
        if (Array.isArray(val)) {
          return val.length > 0;
        }
        return val.length > 0;
      },
      { message: 'Include patterns cannot be empty' }
    ),
    runners: z
      .array(TestRunnerConfigSchema)
      .min(1, 'At least one runner is required'),
    defaultRunner: z.string().optional(),
    reporter: ReporterSchema.optional(),
    bridgeTimeout: z
      .number()
      .min(1000, 'Bridge timeout must be at least 1 second')
      .default(60000),
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
export type Reporter = z.infer<typeof ReporterSchema>;
export type BrowserType = z.infer<typeof BrowserTypeSchema>;
export type NativeTestRunnerConfig = z.infer<
  typeof NativeTestRunnerConfigSchema
>;
export type WebTestRunnerConfig = z.infer<typeof WebTestRunnerConfigSchema>;
export type TestRunnerConfig = z.infer<typeof TestRunnerConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function isNativeRunnerConfig(
  config: TestRunnerConfig
): config is NativeTestRunnerConfig {
  return config.platform === 'ios' || config.platform === 'android';
}

export function isWebRunnerConfig(
  config: TestRunnerConfig
): config is WebTestRunnerConfig {
  return config.platform === 'web';
}

export function assertNativeRunnerConfig(
  config: TestRunnerConfig
): asserts config is NativeTestRunnerConfig {
  if (!isNativeRunnerConfig(config)) {
    throw new Error(
      `Expected native runner config but got platform: ${config.platform}`
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
