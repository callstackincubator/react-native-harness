import { z } from 'zod';
import type { HarnessPlugin } from '@react-native-harness/plugins';
import { isHarnessPlugin } from '@react-native-harness/plugins';
import { logger } from '@react-native-harness/tools';

export const DEFAULT_METRO_PORT = 8081;

const configLogger = logger.child('config');

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
  // Module specifier whose default export adjusts the Metro config for this
  // runner. Set by a platform factory (`HarnessPlatform.metroConfigEnhancer`);
  // imported and run by the bundler while it composes the config.
  metroConfigEnhancer: z.string().optional(),
  // The Metro platform the app requests when it differs from platformId
  // (e.g. Vega apps request "kepler"). Set by the platform factory.
  bundlePlatform: z.string().optional(),
  platformId: z.string(),
  // Set by the platform factories (`HarnessPlatform.getResourceLockKey`) to
  // scope the run's resource lock — e.g. per emulator/simulator/device rather
  // than per platform. A bare `z.object()` strips unknown keys, so without
  // this the harness always fell back to `${platformId}:${name}`.
  getResourceLockKey: z
    .function()
    .args()
    .returns(z.union([z.string(), z.promise(z.string())]))
    .optional(),
});

type AnyHarnessPlugin = HarnessPlugin<object, unknown>;

const PluginSchema = z.custom<AnyHarnessPlugin>(
  (value) => isHarnessPlugin(value),
  'Invalid Harness plugin'
);

export const MetroPortSchema = z
  .number()
  .int('Metro port must be an integer')
  .min(1, 'Metro port must be at least 1')
  .max(65535, 'Metro port must be at most 65535');

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
    metroPort: MetroPortSchema.optional().default(DEFAULT_METRO_PORT),
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
    skipAlreadyIncludedModules: z
      .boolean()
      .optional()
      .describe(
        'Skip re-sending modules already served in the main app bundle when Metro serves ' +
          "a per-test-file bundle. Defaults to true; set to false as an escape hatch if it " +
          'causes issues. Left undefined (rather than defaulted here) so `resolveSkipAlreadyIncludedModules` ' +
          'can tell "not set" apart from "explicitly set" when reconciling with the deprecated ' +
          '`unstable__skipAlreadyIncludedModules` alias.'
      ),
    // Deprecated alias for `skipAlreadyIncludedModules` -- see
    // `resolveSkipAlreadyIncludedModules`. Left without a `.default()` for the
    // same reason: a default value would be indistinguishable from the user
    // never having set it, which would break alias-vs-explicit-flag precedence.
    unstable__skipAlreadyIncludedModules: z
      .boolean()
      .optional()
      .describe(
        'Deprecated. Use `skipAlreadyIncludedModules` instead.'
      ),
    cache: z
      .object({
        metro: z
          .boolean()
          .optional()
          .describe(
            'Enable persistent Metro transform and file-map caching under the .harness cache directory. ' +
              'Defaults to true; set to false to always start with a cold Metro cache. ' +
              'Left undefined (rather than defaulted here) so `resolveMetroCacheEnabled` can tell ' +
              '"not set" apart from "explicitly set" when reconciling with the deprecated ' +
              '`unstable__enableMetroCache` alias.'
          ),
        version: z
          .string()
          .optional()
          .describe(
            'User-controlled salt folded into the Metro cacheVersion. ' +
              'Bump it to force-invalidate previously cached transforms.'
          ),
      })
      .optional(),
    // Deprecated alias for `cache.metro` -- see `resolveMetroCacheEnabled`.
    // Left without a `.default()` for the same reason as
    // `unstable__skipAlreadyIncludedModules`: a default value would be
    // indistinguishable from the user never having set it, which would break
    // alias-vs-explicit-flag precedence.
    unstable__enableMetroCache: z
      .boolean()
      .optional()
      .describe('Deprecated. Use `cache.metro` instead.'),
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
      .union([
        z.boolean(),
        z
          .object({
            enabled: z
              .boolean()
              .optional()
              .describe(
                'Turns diagnostics on or off. Defaults to true when the object form is used.'
              ),
            probes: z
              .object({
                host: z
                  .boolean()
                  .optional()
                  .describe(
                    'Sample host load, CPU split and memory pressure. Defaults to true.'
                  ),
                node: z
                  .boolean()
                  .optional()
                  .describe(
                    'Sample Harness process memory and event loop lag. Defaults to true.'
                  ),
                snapshots: z
                  .boolean()
                  .optional()
                  .describe(
                    'Record a process listing at run milestones (macOS). Defaults to true.'
                  ),
                platform: z
                  .boolean()
                  .optional()
                  .describe(
                    'Record platform specific measurements, such as the process count inside an iOS simulator. Defaults to true.'
                  ),
              })
              .strict()
              .optional(),
            sampleIntervalMs: z
              .number()
              .int()
              .min(250, 'sampleIntervalMs must be at least 250')
              .optional()
              .describe(
                'How often host and process metrics are sampled, in milliseconds. Defaults to 5000.'
              ),
          })
          .strict(),
      ])
      .optional()
      .default(false)
      .describe(
        'Enable diagnostics for the harness session. Records spans for session ' +
          'setup, Metro bundling, bridge/client events, and per-file test runs, ' +
          'samples host and process resource metrics, then writes a Chrome Trace ' +
          'Event JSON file, an incremental JSONL log and a KPI summary, and prints ' +
          'a summary after each run. Pass an object to tune the probes and the ' +
          'sampling interval. Can also be enabled via the RN_HARNESS_DIAGNOSTICS ' +
          'environment variable.'
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
 * `diagnostics` config option (`true`, or an object that does not set
 * `enabled: false`), or via the `RN_HARNESS_DIAGNOSTICS` environment variable
 * (any value other than unset, `''`, `'0'`, or `'false'`).
 */
export const isDiagnosticsEnabled = (
  config: Pick<Config, 'diagnostics'> | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  const diagnostics = config?.diagnostics;
  if (diagnostics === true) {
    return true;
  }
  if (typeof diagnostics === 'object' && diagnostics.enabled !== false) {
    return true;
  }

  const envValue = env.RN_HARNESS_DIAGNOSTICS;
  return !!envValue && envValue !== '0' && envValue !== 'false';
};

export type ResolvedDiagnosticsOptions = {
  probes: {
    host: boolean;
    node: boolean;
    snapshots: boolean;
    platform: boolean;
  };
  /** Undefined means "use the default sampling interval". */
  sampleIntervalMs: number | undefined;
};

/**
 * Resolves the diagnostics tuning options. Every probe is on unless the object
 * form of `diagnostics` switches it off, which is also what the boolean form
 * and the `RN_HARNESS_DIAGNOSTICS` environment variable mean.
 */
export const resolveDiagnosticsOptions = (
  config: Pick<Config, 'diagnostics'> | undefined
): ResolvedDiagnosticsOptions => {
  const diagnostics = config?.diagnostics;
  const options = typeof diagnostics === 'object' ? diagnostics : undefined;

  return {
    probes: {
      host: options?.probes?.host ?? true,
      node: options?.probes?.node ?? true,
      snapshots: options?.probes?.snapshots ?? true,
      platform: options?.probes?.platform ?? true,
    },
    sampleIntervalMs: options?.sampleIntervalMs,
  };
};

/**
 * Resolves the effective value of `skipAlreadyIncludedModules`, reconciling
 * it with the deprecated `unstable__skipAlreadyIncludedModules` alias:
 *
 * - The new flag, when explicitly set, always wins over the alias.
 * - Otherwise, the alias's value is used (with a deprecation warning).
 * - Otherwise, defaults to `true`.
 *
 * The default is applied here rather than in the zod schema so that "unset"
 * and "explicitly set to the default value" remain distinguishable -- that
 * distinction is what lets the deprecated alias keep working as an escape
 * hatch (e.g. `unstable__skipAlreadyIncludedModules: false`) even though the
 * new flag now defaults to `true`.
 */
export const resolveSkipAlreadyIncludedModules = (
  config: Pick<
    Config,
    'skipAlreadyIncludedModules' | 'unstable__skipAlreadyIncludedModules'
  >
): boolean => {
  if (config.unstable__skipAlreadyIncludedModules !== undefined) {
    configLogger.warn(
      '`unstable__skipAlreadyIncludedModules` is deprecated and will be removed in a future release. ' +
        'Use `skipAlreadyIncludedModules` instead.'
    );
  }

  if (config.skipAlreadyIncludedModules !== undefined) {
    return config.skipAlreadyIncludedModules;
  }

  if (config.unstable__skipAlreadyIncludedModules !== undefined) {
    return config.unstable__skipAlreadyIncludedModules;
  }

  return true;
};

/**
 * Resolves whether persistent Metro caching is enabled, reconciling
 * `cache.metro` with the deprecated `unstable__enableMetroCache` alias:
 *
 * - `cache.metro`, when explicitly set, always wins over the alias.
 * - Otherwise, the alias's value is used (with a deprecation warning).
 * - Otherwise, defaults to `true`.
 *
 * The default is applied here rather than in the zod schema so that "unset"
 * and "explicitly set to the default value" remain distinguishable -- that
 * distinction is what lets the deprecated alias keep working as an escape
 * hatch (e.g. `unstable__enableMetroCache: false`) even though caching now
 * defaults to on.
 */
export const resolveMetroCacheEnabled = (
  config: Pick<Config, 'cache' | 'unstable__enableMetroCache'>
): boolean => {
  if (config.unstable__enableMetroCache !== undefined) {
    configLogger.warn(
      '`unstable__enableMetroCache` is deprecated and will be removed in a future release. ' +
        'Use `cache.metro` instead.'
    );
  }

  if (config.cache?.metro !== undefined) {
    return config.cache.metro;
  }

  if (config.unstable__enableMetroCache !== undefined) {
    return config.unstable__enableMetroCache;
  }

  return true;
};
