import { ConfigNotFoundError, getConfig } from '@react-native-harness/config';
import type { HarnessCliCommand } from '@react-native-harness/platforms';

type ConfigLoader = typeof getConfig;

type DiscoveredPlatformCommands = {
  commands: HarnessCliCommand[];
  projectRoot: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getModuleCommands = (
  importedModule: unknown,
  modulePath: string
): HarnessCliCommand[] => {
  const moduleValue = isRecord(importedModule)
    ? importedModule
    : ({} as Record<string, unknown>);
  const defaultExport = isRecord(moduleValue.default)
    ? moduleValue.default
    : undefined;
  const commandsValue = moduleValue.commands ?? defaultExport?.commands;

  if (!Array.isArray(commandsValue)) {
    throw new Error(
      `Invalid platform CLI module '${modulePath}': expected a commands array.`
    );
  }

  return commandsValue.map((command, index) => {
    if (!isRecord(command) || typeof command.name !== 'string') {
      throw new Error(
        `Invalid platform CLI module '${modulePath}': command #${index + 1} is missing a valid name.`
      );
    }

    if (typeof command.run !== 'function') {
      throw new Error(
        `Invalid platform CLI module '${modulePath}': command '${command.name}' is missing a run handler.`
      );
    }

    if (
      command.aliases !== undefined &&
      (!Array.isArray(command.aliases) ||
        command.aliases.some((alias) => typeof alias !== 'string'))
    ) {
      throw new Error(
        `Invalid platform CLI module '${modulePath}': command '${command.name}' has invalid aliases.`
      );
    }

    return command as HarnessCliCommand;
  });
};

const registerCommandNames = (
  seenNames: Map<string, string>,
  modulePath: string,
  command: HarnessCliCommand
) => {
  const names = [command.name, ...(command.aliases ?? [])];

  for (const name of names) {
    const existingSource = seenNames.get(name);

    if (existingSource !== undefined) {
      throw new Error(
        `Duplicate platform CLI command '${name}' in '${modulePath}' and '${existingSource}'.`
      );
    }

    seenNames.set(name, modulePath);
  }
};

export const discoverPlatformCommands = async (options: {
  cwd: string;
  loadConfig?: ConfigLoader;
}): Promise<DiscoveredPlatformCommands | null> => {
  const loadConfig = options.loadConfig ?? getConfig;

  try {
    const { config, projectRoot } = await loadConfig(options.cwd);
    const modulePaths = [...new Set(config.runners.map((runner) => runner.cli))].filter(
      (modulePath): modulePath is string => typeof modulePath === 'string'
    );
    const commands: HarnessCliCommand[] = [];
    const seenNames = new Map<string, string>();

    for (const modulePath of modulePaths) {
      const importedModule = await import(modulePath);
      const moduleCommands = getModuleCommands(importedModule, modulePath);

      for (const command of moduleCommands) {
        registerCommandNames(seenNames, modulePath, command);
        commands.push(command);
      }
    }

    return {
      commands,
      projectRoot,
    };
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      return null;
    }

    throw error;
  }
};

export const runPlatformCommand = async (options: {
  argv: string[];
  cwd: string;
  loadConfig?: ConfigLoader;
}): Promise<boolean> => {
  const commandName = options.argv[0];

  if (typeof commandName !== 'string' || commandName.length === 0) {
    return false;
  }

  const discoveredCommands = await discoverPlatformCommands(options);

  if (discoveredCommands === null) {
    return false;
  }

  const command = discoveredCommands.commands.find(
    (entry) =>
      entry.name === commandName || entry.aliases?.includes(commandName) === true
  );

  if (command === undefined) {
    return false;
  }

  await command.run(options.argv.slice(1), {
    cwd: options.cwd,
    projectRoot: discoveredCommands.projectRoot,
  });

  return true;
};
