import {
  promptMultiselect,
  spinner,
  cancelPromptAndExit,
  installDevDependency,
} from '@react-native-harness/tools';

export const installPlatforms = async (): Promise<string[]> => {
  const projectRoot = process.cwd();
  const selectedPlatforms = await promptMultiselect({
    message: 'Select platforms to support',
    options: [
      { value: 'android', label: 'Android' },
      { value: 'ios', label: 'iOS' },
      { value: 'web', label: 'Web' },
    ],
  });

  if (selectedPlatforms.length === 0) {
    cancelPromptAndExit('At least one platform must be selected.');
  }

  const installSpinner = spinner();
  installSpinner.start('Installing platform packages...');

  const packagesToInstall: string[] = [];
  if (selectedPlatforms.includes('android'))
    packagesToInstall.push('@react-native-harness/platform-android');
  if (selectedPlatforms.includes('ios'))
    packagesToInstall.push('@react-native-harness/platform-apple');
  if (selectedPlatforms.includes('web'))
    packagesToInstall.push('@react-native-harness/platform-web');

  try {
    await installDevDependency(projectRoot, packagesToInstall);
    installSpinner.stop('Platform packages installed successfully.');
  } catch (error) {
    installSpinner.stop('Failed to install platform packages.', 1);
    console.error(error);
    process.exit(1);
  }

  return selectedPlatforms as string[];
};
