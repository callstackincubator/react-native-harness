import { z } from 'zod';
import type { HarnessPlugin } from '@react-native-harness/plugins';
import { isHarnessPlugin } from '@react-native-harness/plugins';

export const DEFAULT_METRO_PORT = 8081;

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
  platformId: z.string(),
});

type AnyHarnessPlugin = HarnessPlugin<any, any, any>;

const PluginSchema = z.custom<AnyHarnessPlugin>(
  (value) => isHarnessPlugin(value),
  'Invalid Harness plugin'
);

export const ConfigSchema = z
  .object({
    entryPoint: z.string().min(1, 'Entry point is required'),
    appRegistryComponentName: z
      .string()
      .min(1, 'App registry component name is required'),
    runners: z.array(RunnerSchema).min(1, 'At least one runner is required'),
    plugins: z.array(PluginSchema).optional().default([]),
    defaultRunner: z.string().optional(),
    host: z.string().min(1, 'Host is required').optional(),
    metroPort: z
      .number()
      .int('Metro port must be an integer')
      .min(1, 'Metro port must be at least 1')
      .max(65535, 'Metro port must be at most 65535')
      .optional()
      .default(DEFAULT_METRO_PORT),
    webSocketPort: z.number().optional().default(3001),
    bridgeTimeout: z
      .number()
      .min(1000, 'Bridge timeout must be at least 1 second')
      .default(60000),

    bundleStartTimeout: z
      .number()
      .min(1000, 'Bundle start timeout must be at least 1 second')
      .default(60000),
    maxAppRestarts: z
      .number()
      .min(0, 'Max app restarts must be at least 0')
      .default(2),

    resetEnvironmentBetweenTestFiles: z.boolean().optional().default(true),
    unstable__skipAlreadyIncludedModules: z.boolean().optional().default(false),
    unstable__enableMetroCache: z.boolean().optional().default(false),

    detectNativeCrashes: z.boolean().optional().default(true),
    crashDetectionInterval: z
      .number()
      .min(100, 'Crash detection interval must be at least 100ms')
      .default(500),

    disableViewFlattening: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Disable view flattening in React Native. This will set collapsable={true} for all View components ' +
        'to ensure they are not flattened by the native layout engine.'
      ),

    coverage: z
      .object({
        root: z
          .string()
          .optional()
          .describe(
            'Root directory for coverage instrumentation in monorepo setups. ' +
            'Specifies the directory from which coverage data should be collected. ' +
            'Use ".." for create-react-native-library projects where tests run from example/ ' +
            "but source files are in parent directory. Passed to babel-plugin-istanbul's cwd option."
          ),
      })
      .optional(),

    forwardClientLogs: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Enable forwarding of console.log, console.warn, console.error, and other console method calls from the React Native app to the terminal. ' +
        'When enabled, all console output from your app will be displayed in the test runner terminal with styled level indicators (log, warn, error).'
      ),

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
