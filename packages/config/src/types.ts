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
  cli: z.string().optional(),
  platformId: z.string(),
});

type AnyHarnessPlugin = HarnessPlugin<object, unknown>;

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
    webSocketPort: z
      .number()
      .optional()
      .describe(
        'Deprecated. Bridge traffic now uses metroPort and this value is ignored.'
      ),
    bridgeTimeout: z
      .number()
      .min(1000, 'Bridge timeout must be at least 1 second')
      .default(60000),

    testTimeout: z
      .number()
      .min(1000, 'Test timeout must be at least 1 second')
      .default(5000),

    platformReadyTimeout: z
      .number()
      .min(1000, 'Platform ready timeout must be at least 1 second')
      .default(300000),

    bundleStartTimeout: z
      .number()
      .min(1000, 'Bundle start timeout must be at least 1 second')
      .default(60000),
    maxAppRestarts: z
      .number()
      .min(0, 'Max app restarts must be at least 0')
      .default(2),
    eagerPrewarm: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'Start building the Metro bundle while the platform (emulator, simulator, or browser) is still booting, ' +
          'so the first bundle is ready sooner. Disable to defer the first bundle build until app startup.'
      ),

    resetEnvironmentBetweenTestFiles: z
      .union([z.boolean(), z.enum(['process', 'runtime'])])
      .optional()
      .default(true)
      .describe(
        'Controls how the environment is reset between test files. `true` (default) and `\'process\'` ' +
          'kill and cold-restart the app process. `\'runtime\'` reloads the JS runtime in place ' +
          '(DevSettings.reload() / window.location.reload()), which is cheaper but escalates to a ' +
          'process restart if the reload fails or the app does not reconnect in time. `false` disables ' +
          'resetting the environment between test files entirely.'
      ),
    unstable__skipAlreadyIncludedModules: z.boolean().optional().default(false),
    unstable__enableMetroCache: z.boolean().optional().default(false),
    permissions: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Enable platform-specific permission prompt automation. When false, Harness does not start permission-handling helpers such as the iOS XCTest agent.'
      ),

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
        native: z
          .object({
            ios: z
              .object({
                pods: z
                  .array(z.string())
                  .min(1, 'At least one pod name is required')
                  .describe(
                    'Pod names to instrument for native code coverage. ' +
                    'Coverage flags are injected at pod install time via a CocoaPods hook. ' +
                    'After tests, profraw data is collected and converted to lcov format.'
                  ),
              })
              .optional(),
          })
          .optional()
          .describe('Native code coverage configuration.'),
      })
      .optional(),

    forwardClientLogs: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Enable forwarding of console.log, console.warn, console.error, and other console method calls from the React Native app during the active test run. ' +
          "When enabled, app console output is attached to the active test result's console output."
      ),

    diagnostics: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Enable diagnostics tracing for the harness session. Records spans for ' +
          'session setup, Metro bundling, bridge/client events, and per-file test runs, ' +
          'then writes a Chrome Trace Event JSON file and prints a summary after each run. ' +
          'Can also be enabled via the RN_HARNESS_DIAGNOSTICS environment variable.'
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

/**
 * Resolves whether diagnostics tracing is enabled: either explicitly via the
 * `diagnostics` config option, or via the `RN_HARNESS_DIAGNOSTICS` environment
 * variable (any value other than unset, `''`, `'0'`, or `'false'`).
 */
export const isDiagnosticsEnabled = (
  config: Pick<Config, 'diagnostics'> | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  if (config?.diagnostics === true) {
    return true;
  }

  const envValue = env.RN_HARNESS_DIAGNOSTICS;
  return !!envValue && envValue !== '0' && envValue !== 'false';
};
