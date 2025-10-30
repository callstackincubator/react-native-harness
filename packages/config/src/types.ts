import { z } from 'zod';

export const ConfigSchema = z
  .object({
    entryPoint: z.string().min(1, 'Entry point is required'),
    appRegistryComponentName: z
      .string()
      .min(1, 'App registry component name is required'),
    runners: z.array(z.any()).min(1, 'At least one runner is required'),
    defaultRunner: z.string().optional(),
    bridgeTimeout: z
      .number()
      .min(1000, 'Bridge timeout must be at least 1 second')
      .default(60000),

    resetEnvironmentBetweenTestFiles: z.boolean().optional().default(true),
    unstable__skipAlreadyIncludedModules: z.boolean().optional().default(false),
    unstable__enableMetroCache: z.boolean().optional().default(false),

    // Deprecated property - used for migration detection
    include: z.array(z.string()).optional(),
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

export type Config = z.infer<typeof ConfigSchema>;
