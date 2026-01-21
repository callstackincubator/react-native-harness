import { z } from 'zod';

const RunnerSchema = z.object({
  name: z
    .string()
    .min(1, 'Runner name is required')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Runner name can only contain alphanumeric characters, dots, underscores, and hyphens'
    ),
  config: z.record(z.any()),
  runner: z.string(),
});

export const ConfigSchema = z
  .object({
    entryPoint: z.string().min(1, 'Entry point is required'),
    appRegistryComponentName: z
      .string()
      .min(1, 'App registry component name is required'),
    runners: z.array(RunnerSchema).min(1, 'At least one runner is required'),
    defaultRunner: z.string().optional(),
    webSocketPort: z.number().optional().default(3001),
    bridgeTimeout: z
      .number()
      .min(1000, 'Bridge timeout must be at least 1 second')
      .default(60000),

    bundleStartTimeout: z
      .number()
      .min(1000, 'Bundle start timeout must be at least 1 second')
      .default(15000),

    maxAppRestarts: z
      .number()
      .min(0, 'Max app restarts must be non-negative')
      .default(2),

    resetEnvironmentBetweenTestFiles: z.boolean().optional().default(true),
    unstable__skipAlreadyIncludedModules: z.boolean().optional().default(false),
    unstable__enableMetroCache: z.boolean().optional().default(false),

    detectNativeCrashes: z.boolean().optional().default(true),
    crashDetectionInterval: z
      .number()
      .min(100, 'Crash detection interval must be at least 100ms')
      .default(500),

    coverage: z
      .object({
        root: z
          .string()
          .optional()
          .describe(
            'Root directory for coverage instrumentation in monorepo setups. ' +
            'Specifies the directory from which coverage data should be collected. ' +
            'Use ".." for create-react-native-library projects where tests run from example/ ' +
            'but source files are in parent directory. Passed to babel-plugin-istanbul\'s cwd option.'
          ),
      })
      .optional(),

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
