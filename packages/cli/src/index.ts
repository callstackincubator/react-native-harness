import { run, yargsOptions } from 'jest-cli';
import { getConfig } from '@react-native-harness/config';
import { runInitWizard } from './wizard/index.js';
import { runPlatformCommand } from './platform-commands.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JEST_CONFIG_EXTENSIONS = ['.mjs', '.js', '.cjs'];
const JEST_HARNESS_CONFIG_BASE = 'jest.harness.config';
const SKILLS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills'
);

type SkillMetadata = {
  fileName: string;
  name: string;
  description: string;
};

const readSkillMetadata = (fileName: string): SkillMetadata => {
  const filePath = path.join(SKILLS_DIRECTORY, fileName);
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  const metadata = {
    name: fileName.replace(/\.md$/, ''),
    description: '',
  };

  if (frontmatterMatch) {
    for (const line of frontmatterMatch[1].split('\n')) {
      const separatorIndex = line.indexOf(':');

      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

      if (key === 'name') {
        metadata.name = value;
      }

      if (key === 'description') {
        metadata.description = value;
      }
    }
  }

  return {
    fileName,
    name: metadata.name,
    description: metadata.description,
  };
};

const listSkills = () =>
  fs
    .readdirSync(SKILLS_DIRECTORY)
    .filter((file) => file.endsWith('.md'))
    .map(readSkillMetadata)
    .sort((left, right) => left.name.localeCompare(right.name));

const printSkillList = () => {
  for (const skill of listSkills()) {
    console.log(`${skill.name}: ${skill.description}`);
  }
};

const printSkillUsage = () => {
  console.log(`Usage: harness skill <command>

Commands:
  list                 List bundled skills
  get <name>           Print a bundled skill file

Examples:
  harness skill list
  harness skill get core`);
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const runSkillCommand = () => {
  const [, , commandName, subcommand, skillName] = process.argv;

  if (subcommand === undefined || subcommand === 'list') {
    printSkillList();
    return;
  }

  if (subcommand === '--help' || subcommand === '-h') {
    printSkillUsage();
    return;
  }

  if (subcommand === 'get') {
    if (!skillName) {
      console.error('Missing skill name.');
      printSkillUsage();
      process.exit(1);
    }

    const skillPath = path.join(SKILLS_DIRECTORY, `${skillName}.md`);

    if (!fs.existsSync(skillPath)) {
      console.error(`Unknown skill '${skillName}'.`);
      console.error(
        `Available skills: ${listSkills()
          .map((skill) => skill.name)
          .join(', ')}`
      );
      process.exit(1);
    }

    console.log(fs.readFileSync(skillPath, 'utf8'));
    return;
  }

  console.error(`Unknown ${commandName} subcommand '${subcommand}'.`);
  printSkillUsage();
  process.exit(1);
};

const checkForOldConfig = async () => {
  try {
    const { config } = await getConfig(process.cwd());

    if (config.include) {
      console.error('\n❌ Migration required\n');
      console.error('React Native Harness has migrated to the Jest CLI.');
      console.error(
        'The "include" property in your rn-harness.config file is no longer supported.\n'
      );
      console.error(
        'Please follow the migration guide to update your configuration:'
      );
      console.error(
        'https://react-native-harness.dev/docs/guides/migration-guide\n'
      );
      process.exit(1);
    }
  } catch {
    // Swallow the error - if we can't load the config, let Jest CLI handle it
  }
};

const patchYargsOptions = () => {
  yargsOptions.harnessRunner = {
    type: 'string',
    description: 'Specify which harness runner to use',
    requiresArg: true,
  };

  // Remove all options that are not supported by Harness
  delete yargsOptions.runner;
  delete yargsOptions.testRunner;
  delete yargsOptions.testEnvironment;
  delete yargsOptions.testEnvironmentOptions;
  delete yargsOptions.transform;
  delete yargsOptions.transformIgnorePatterns;
  delete yargsOptions.updateSnapshot;
  delete yargsOptions.workerThreads;
  delete yargsOptions.snapshotSerializers;
  delete yargsOptions.shard;
  delete yargsOptions.runInBand;
  delete yargsOptions.resolver;
  delete yargsOptions.resetMocks;
  delete yargsOptions.resetModules;
  delete yargsOptions.restoreMocks;
  delete yargsOptions.preset;
  delete yargsOptions.prettierPath;
  delete yargsOptions.maxWorkers;
  delete yargsOptions.moduleDirectories;
  delete yargsOptions.moduleFileExtensions;
  delete yargsOptions.moduleNameMapper;
  delete yargsOptions.modulePathIgnorePatterns;
  delete yargsOptions.modulePaths;
  delete yargsOptions.maxConcurrency;
  delete yargsOptions.injectGlobals;
  delete yargsOptions.globalSetup;
  delete yargsOptions.globalTeardown;
  delete yargsOptions.clearMocks;
  delete yargsOptions.globals;
  delete yargsOptions.haste;
  delete yargsOptions.automock;
  delete yargsOptions.coverageProvider;
  delete yargsOptions.logHeapUsage;
};

const main = async () => {
  if (process.argv[2] === 'skill' || process.argv[2] === 'skills') {
    runSkillCommand();
    return;
  }

  if (process.argv.includes('init')) {
    runInitWizard();
    return;
  }

  if (
    await runPlatformCommand({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
    })
  ) {
    return;
  }

  patchYargsOptions();

  const hasConfigArg =
    process.argv.includes('--config') || process.argv.includes('-c');

  if (!hasConfigArg) {
    const existingConfigExt = JEST_CONFIG_EXTENSIONS.find((ext) =>
      fs.existsSync(
        path.join(process.cwd(), `${JEST_HARNESS_CONFIG_BASE}${ext}`)
      )
    );

    if (existingConfigExt) {
      process.argv.push(
        '--config',
        `${JEST_HARNESS_CONFIG_BASE}${existingConfigExt}`
      );
    }
  }

  await checkForOldConfig();
  run();
};

main().catch((error) => {
  console.error(getErrorMessage(error));
  process.exit(1);
});
