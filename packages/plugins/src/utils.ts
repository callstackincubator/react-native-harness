import type { HookLogger } from './types.js';

export const isHookTree = (value: unknown): boolean => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  for (const child of Object.values(value)) {
    if (child === undefined) {
      continue;
    }

    if (typeof child === 'function') {
      continue;
    }

    if (
      child == null ||
      typeof child !== 'object' ||
      Array.isArray(child) ||
      !isHookTree(child)
    ) {
      return false;
    }
  }

  return true;
};

export const createPluginLogger = (pluginName: string): HookLogger => {
  const prefix = `[plugin:${pluginName}]`;

  return {
    debug: (...messages) => console.debug(prefix, ...messages),
    info: (...messages) => console.info(prefix, ...messages),
    warn: (...messages) => console.warn(prefix, ...messages),
    error: (...messages) => console.error(prefix, ...messages),
  };
};

export const getNestedValue = (
  value: unknown,
  path: readonly string[]
): unknown => {
  let current = value;

  for (const segment of path) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};
