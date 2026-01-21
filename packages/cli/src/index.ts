import { run, yargsOptions } from 'jest-cli';
import { getConfig } from '@react-native-harness/config';
import { runInitWizard } from './wizard/index.js';
import fs from 'node:fs';
import path from 'node:path';

const JEST_CONFIG_EXTENSIONS = ['.mjs', '.js', '.cjs'];
const JEST_HARNESS_CONFIG_BASE = 'jest.harness.config';

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

if (process.argv.includes('init')) {
  runInitWizard();
} else {
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

  checkForOldConfig().then(() => run());
}
