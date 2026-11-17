import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigLoadError, InvalidConfigError } from './errors.js';
import type { CompilerConfig } from './types.js';

type ConfigExport =
  | CompilerConfig
  | Promise<CompilerConfig>
  | ((
      env: Record<string, unknown>,
      argv: Record<string, unknown>
    ) => CompilerConfig | Promise<CompilerConfig>);

/**
 * Loads the project's config file: an object, a function (called the way the
 * webpack CLI calls it, in development mode) or a promise, from CommonJS or
 * ESM.
 */
export const loadConfig = async (
  projectRoot: string,
  configPath: string
): Promise<CompilerConfig> => {
  const file = path.resolve(projectRoot, configPath);
  let exported: ConfigExport;

  try {
    const module = (await import(pathToFileURL(file).href)) as {
      default?: ConfigExport | { __esModule?: boolean; default?: ConfigExport };
    };
    const value = module.default ?? (module as unknown as ConfigExport);
    // A config transpiled to CommonJS (`exports.default = ...`) arrives
    // wrapped once more.
    exported = (
      typeof value === 'object' &&
      value !== null &&
      '__esModule' in value &&
      value.default !== undefined
        ? value.default
        : value
    ) as ConfigExport;
  } catch (error) {
    throw new ConfigLoadError(configPath, error);
  }

  const config =
    typeof exported === 'function'
      ? await exported({}, { mode: 'development' })
      : await exported;

  if (Array.isArray(config)) {
    throw new InvalidConfigError(
      configPath,
      'it exports an array of configurations. Harness runs one compiler: export a single configuration.'
    );
  }

  if (typeof config !== 'object' || config === null) {
    throw new InvalidConfigError(
      configPath,
      'it does not export a configuration object, a function that returns one, or a promise of one.'
    );
  }

  return config;
};
