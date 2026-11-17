import { METRO_BUNDLER_NAME } from '@react-native-harness/bundler-metro';
import type {
  BundlerHookPayloads,
  BundlerHookSuffix,
  HarnessPluginManager,
} from '@react-native-harness/plugins';
import type { HarnessPlatform } from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';

type CallHook = HarnessPluginManager<HarnessConfig, HarnessPlatform>['callHook'];

export type CallBundlerHook = <TSuffix extends BundlerHookSuffix>(
  name: TSuffix,
  payload: BundlerHookPayloads[TSuffix]
) => Promise<void>;

/**
 * The one place that fires the bundler hooks, bound to the session's bundler.
 * `bundler:*` fires for every bundler. The `metro:*` hook with the same
 * payload also fires when the bundler is Metro, which keeps plugins written
 * against it working.
 */
export const createBundlerHookCaller = (
  callHook: CallHook,
  bundlerName: string
): CallBundlerHook => {
  const isMetro = bundlerName === METRO_BUNDLER_NAME;

  const handlers: {
    [TSuffix in BundlerHookSuffix]: (
      payload: BundlerHookPayloads[TSuffix]
    ) => Promise<void>;
  } = {
    initialized: async (payload) => {
      if (isMetro) await callHook('metro:initialized', payload);
      await callHook('bundler:initialized', payload);
    },
    'bundle-started': async (payload) => {
      if (isMetro) await callHook('metro:bundle-started', payload);
      await callHook('bundler:bundle-started', payload);
    },
    'bundle-finished': async (payload) => {
      if (isMetro) await callHook('metro:bundle-finished', payload);
      await callHook('bundler:bundle-finished', payload);
    },
    'bundle-failed': async (payload) => {
      if (isMetro) await callHook('metro:bundle-failed', payload);
      await callHook('bundler:bundle-failed', payload);
    },
    'client-log': async (payload) => {
      if (isMetro) await callHook('metro:client-log', payload);
      await callHook('bundler:client-log', payload);
    },
  };

  return (name, payload) => handlers[name](payload);
};
