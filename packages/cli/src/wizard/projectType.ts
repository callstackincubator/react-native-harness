import fs from 'node:fs';
import path from 'node:path';
import { promptSelect, promptText } from '@react-native-harness/tools';

export type ProjectConfig = {
  entryPoint: string;
  appRegistryComponentName: string;
};

const tryExtractComponentName = (entryPoint: string): string | undefined => {
  try {
    const filePath = path.resolve(process.cwd(), entryPoint);
    if (!fs.existsSync(filePath)) return undefined;

    const content = fs.readFileSync(filePath, 'utf8');
    // Look for AppRegistry.registerComponent('Name', ...) or AppRegistry.registerComponent("Name", ...)
    const match = content.match(
      /AppRegistry\.registerComponent\(\s*['"](.+?)['"]/
    );

    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
};

export const getProjectConfig = async (): Promise<ProjectConfig> => {
  const projectType = await promptSelect({
    message: 'What type of project is this?',
    options: [
      { value: 'expo', label: 'Expo' },
      { value: 'custom', label: 'React Native CLI / Custom' },
    ],
  });

  if (projectType === 'expo') {
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
      );
      return {
        entryPoint: packageJson.main || './node_modules/expo/AppEntry.js',
        appRegistryComponentName: 'main',
      };
    } catch {
      return {
        entryPoint: './node_modules/expo/AppEntry.js',
        appRegistryComponentName: 'main',
      };
    }
  }

  const entryPoint = await promptText({
    message: 'Enter the path to your app entry file',
    initialValue: './index.js',
    placeholder: './index.js',
    validate: (value: string | undefined) => {
      if (!value) return 'Entry point is required';
      return;
    },
  });

  const suggestedComponentName = tryExtractComponentName(entryPoint);

  const appRegistryComponentName = await promptText({
    message:
      'Enter the name of the component registered via AppRegistry.registerComponent()',
    placeholder: 'MyAppName',
    initialValue: suggestedComponentName,
    validate: (value: string | undefined) => {
      if (!value) return 'Component name is required';
      return;
    },
  });

  return { entryPoint, appRegistryComponentName };
};
