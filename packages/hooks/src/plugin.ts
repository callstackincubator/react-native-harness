import type { HarnessPlatform } from '@react-native-harness/platforms';
import type { HarnessPlugin } from './types.js';
import { isHookTree } from './utils.js';

export const definePlugin = <
  TState extends object = Record<string, never>,
  TConfig = unknown,
  TRunner extends HarnessPlatform = HarnessPlatform,
>(
  plugin: HarnessPlugin<TState, TConfig, TRunner>
): HarnessPlugin<TState, TConfig, TRunner> => {
  return plugin;
};

export const isHarnessPlugin = (value: unknown): value is HarnessPlugin => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as HarnessPlugin;

  if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
    return false;
  }

  if (candidate.createState != null && typeof candidate.createState !== 'function') {
    return false;
  }

  if (candidate.hooks != null && !isHookTree(candidate.hooks)) {
    return false;
  }

  return true;
};
