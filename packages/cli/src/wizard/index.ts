import {
  intro,
  outro,
  note,
  isProject,
  cancelPromptAndExit,
  promptConfirm,
} from '@react-native-harness/tools';
import { getProjectConfig } from './projectType.js';
import { installPlatforms } from './platforms.js';
import { discoverTargets } from './targets.js';
import { getBundleIds } from './bundleId.js';
import { generateConfig } from './configGenerator.js';
import { createJestConfig } from './jestConfig.js';
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json'];

const checkForExistingConfig = async (projectRoot: string) => {
  const existingConfig = CONFIG_EXTENSIONS.find((ext) =>
    fs.existsSync(path.join(projectRoot, `rn-harness.config${ext}`))
  );

  if (existingConfig) {
    const shouldOverwrite = await promptConfirm({
      message: `A configuration file (rn-harness.config${existingConfig}) already exists. Are you sure you want to overwrite it?`,
      confirmLabel: 'Overwrite',
      cancelLabel: 'Keep existing',
    });

    if (!shouldOverwrite) {
      cancelPromptAndExit('Setup cancelled. Keeping existing configuration.');
    }
  }
};

export const runInitWizard = async () => {
  const projectRoot = process.cwd();

  if (!isProject(projectRoot)) {
    cancelPromptAndExit(
      'React Native Harness must be run in a React Native project root (directory with package.json containing react-native).'
    );
  }

  intro('React Native Harness');

  note(
    "This wizard will guide you through the setup process to get React Native Harness up and running in your project. We'll help you configure your project type, platforms, and test targets.",
    'Configuration wizard'
  );

  await checkForExistingConfig(projectRoot);

  const projectConfig = await getProjectConfig();
  const selectedPlatforms = await installPlatforms();
  const selectedTargets = await discoverTargets(selectedPlatforms);
  const bundleIds = await getBundleIds(selectedPlatforms);

  generateConfig(projectConfig, selectedPlatforms, selectedTargets, bundleIds);
  await createJestConfig(projectRoot);

  note(
    'A dedicated Jest configuration (jest.harness.config.mjs) has been created. Harness will automatically use it when you run the "harness" command.',
    'Jest configuration'
  );

  outro(
    'Setup complete. Happy testing!'
  );
};
