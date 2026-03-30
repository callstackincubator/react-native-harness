import { createHooks } from 'hookable';
import { logger } from '@react-native-harness/tools';
import type { HarnessPlatform } from '@react-native-harness/platforms';
import {
  type FlatHarnessHookContexts,
  HARNESS_HOOKS,
  type HarnessPlugin,
} from './types.js';
import { createPluginLogger, getNestedValue } from './utils.js';

const pluginsLogger = logger.child('plugins');

type ManagerOptions<TConfig, TRunner extends HarnessPlatform> = {
  plugins: Array<HarnessPlugin<object, TConfig, TRunner>>;
  projectRoot: string;
  config: TConfig;
  runner: TRunner;
  abortSignal: AbortSignal;
};

type HookName<TConfig, TRunner extends HarnessPlatform> = keyof FlatHarnessHookContexts<
  object,
  TConfig,
  TRunner
>;

type HookPayload<
  TConfig,
  TRunner extends HarnessPlatform,
  TName extends HookName<TConfig, TRunner>,
> = Omit<
  FlatHarnessHookContexts<object, TConfig, TRunner>[TName],
  | 'plugin'
  | 'logger'
  | 'projectRoot'
  | 'config'
  | 'runner'
  | 'platform'
  | 'state'
  | 'timestamp'
  | 'abortSignal'
  | 'meta'
>;

type FlatHookRegistry<TConfig, TRunner extends HarnessPlatform> = Record<
  HookName<TConfig, TRunner>,
  (payload: unknown) => Promise<void>
>;

export type HarnessPluginManager<
  TConfig = unknown,
  TRunner extends HarnessPlatform = HarnessPlatform,
> = {
  hasPlugins: () => boolean;
  callHook: <TName extends HookName<TConfig, TRunner>>(
    name: TName,
    payload: HookPayload<TConfig, TRunner, TName>
  ) => Promise<void>;
};

export const createHarnessPluginManager = <
  TConfig,
  TRunner extends HarnessPlatform,
>({
  plugins,
  projectRoot,
  config,
  runner,
  abortSignal,
}: ManagerOptions<TConfig, TRunner>): HarnessPluginManager<TConfig, TRunner> => {
  const hooks = createHooks<FlatHookRegistry<TConfig, TRunner>>();
  let invocationCount = 0;

  for (const plugin of plugins) {
    const state = plugin.createState?.() ?? {};
    const pluginLogger = createPluginLogger(plugin.name);

    for (const hookDefinition of HARNESS_HOOKS) {
      const handler = getNestedValue(plugin.hooks, hookDefinition.path);

      if (typeof handler !== 'function') {
        continue;
      }

      const hookName = hookDefinition.flatName as HookName<TConfig, TRunner>;
      const typedHandler = handler as (payload: unknown) => Promise<void> | void;

      hooks.hook(hookName, async (payload: unknown) => {
        const typedPayload = payload as HookPayload<
          TConfig,
          TRunner,
          typeof hookName
        >;
        const timestamp = Date.now();
        const invocationId = `${hookName}-${++invocationCount}`;

        try {
          await typedHandler({
            ...typedPayload,
            plugin: {
              name: plugin.name,
            },
            logger: pluginLogger,
            projectRoot,
            config,
            runner,
            platform: {
              name: runner.name,
              platformId: runner.platformId,
            },
            state,
            timestamp,
            abortSignal,
            meta: {
              hook: hookName,
              invocationId,
              runId:
                'runId' in typedPayload && typeof typedPayload.runId === 'string'
                  ? typedPayload.runId
                  : undefined,
            },
          });

          if (logger.isVerbose()) {
            pluginsLogger.debug(
              'hook completed: plugin=%s hook=%s invocationId=%s duration=%dms outcome=success',
              plugin.name,
              hookName,
              invocationId,
              Date.now() - timestamp
            );
          }
        } catch (error) {
          if (logger.isVerbose()) {
            pluginsLogger.debug(
              'hook completed: plugin=%s hook=%s invocationId=%s duration=%dms outcome=error',
              plugin.name,
              hookName,
              invocationId,
              Date.now() - timestamp
            );
            pluginsLogger.debug(error);
          }

          throw error;
        }
      });
    }
  }

  return {
    hasPlugins: () => plugins.length > 0,
    callHook: async (name, payload) => {
      if (plugins.length === 0) {
        return;
      }

      await hooks.callHook(
        name,
        ...([
          payload,
        ] as Parameters<FlatHookRegistry<TConfig, TRunner>[typeof name]>)
      );
    },
  };
};
