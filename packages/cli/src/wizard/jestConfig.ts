import fs from 'node:fs';
import path from 'node:path';
import { promptConfirm } from '@react-native-harness/tools';

export const createJestConfig = async (projectRoot: string) => {
  const configPath = path.join(projectRoot, 'jest.harness.config.mjs');

  if (fs.existsSync(configPath)) {
    const shouldOverwrite = await promptConfirm({
      message:
        'A dedicated Jest configuration (jest.harness.config.mjs) already exists. Do you want to overwrite it?',
      confirmLabel: 'Overwrite',
      cancelLabel: 'Keep existing',
    });

    if (!shouldOverwrite) {
      return;
    }
  }

  const configContent = `export default {
  preset: 'react-native-harness',
  testMatch: ['<rootDir>/**/__tests__/**/*.harness.[jt]s?(x)'],
};
`;

  fs.writeFileSync(configPath, configContent);
};
