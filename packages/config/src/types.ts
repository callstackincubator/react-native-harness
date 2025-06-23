import { z } from 'zod';

export const PlatformSchema = z.enum(['ios', 'android']);

export const ReporterSchema = z.object({
  report: z.function().args(z.array(z.any())).returns(z.promise(z.void())),
});

export const TestRunnerConfigSchema = z.object({
  name: z.string().min(1, 'Runner name is required'),
  platform: PlatformSchema,
  deviceId: z.string().min(1, 'Device ID is required'),
  bundleId: z.string().min(1, 'Bundle ID is required'),
});

export const ConfigSchema = z.object({
  include: z.union([z.string(), z.array(z.string())]).refine(
    (val) => {
      if (Array.isArray(val)) {
        return val.length > 0;
      }
      return val.length > 0;
    },
    { message: 'Include patterns cannot be empty' }
  ),
  runners: z.array(TestRunnerConfigSchema).min(1, 'At least one runner is required'),
  defaultRunner: z.string().optional(),
  reporter: ReporterSchema.optional(),
}).refine(
  (config) => {
    if (config.defaultRunner) {
      return config.runners.some(runner => runner.name === config.defaultRunner);
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
export type TestRunnerConfig = z.infer<typeof TestRunnerConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
