import { promptText } from '@react-native-harness/tools';

export const getBundleIds = async (
  selectedPlatforms: string[]
): Promise<Record<string, string>> => {
  const bundleIds: Record<string, string> = {};

  if (selectedPlatforms.includes('android')) {
    bundleIds.android = await promptText({
      message: 'Enter Android package name',
      placeholder: 'com.example.app',
      validate: (value: string | undefined) => {
        if (!value) return 'Package name is required';
        const parts = value.split('.');
        if (parts.length < 2) {
          return 'Package name must have at least two segments (e.g., com.example)';
        }
        for (const segment of parts) {
          if (!segment) return 'Segments cannot be empty';
          if (!/^[a-zA-Z]/.test(segment)) {
            return `Segment "${segment}" must start with a letter`;
          }
          if (!/^[a-zA-Z0-9_]+$/.test(segment)) {
            return `Segment "${segment}" can only contain alphanumeric characters or underscores`;
          }
        }
        return;
      },
    });
  }

  if (selectedPlatforms.includes('ios')) {
    bundleIds.ios = await promptText({
      message: 'Enter iOS bundle identifier',
      placeholder: 'com.example.app',
      validate: (value: string | undefined) => {
        if (!value) return 'Bundle identifier is required';
        if (!/^[a-zA-Z0-9.-]+$/.test(value)) {
          return 'Bundle identifier can only contain alphanumeric characters, hyphens, and periods';
        }
        if (value.startsWith('.') || value.endsWith('.')) {
          return 'Bundle identifier cannot start or end with a period';
        }
        if (value.includes('..')) {
          return 'Bundle identifier cannot contain consecutive periods';
        }
        return;
      },
    });
  }

  if (selectedPlatforms.includes('web')) {
    bundleIds.web = await promptText({
      message: 'Enter application URL',
      initialValue: 'http://localhost:8081/index.html',
      placeholder: 'http://localhost:8081/index.html',
      validate: (value: string | undefined) => {
        if (!value) return 'URL is required';
        try {
          new URL(value);
          return;
        } catch (e) {
          return 'Please enter a valid URL';
        }
      },
    });
  }

  return bundleIds;
};
