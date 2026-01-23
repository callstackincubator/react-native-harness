import {
  spinner,
  promptAutocompleteMultiselect,
  cancelPromptAndExit,
} from '@react-native-harness/tools';
import type { RunTarget } from '@react-native-harness/platforms';

export const discoverTargets = async (
  selectedPlatforms: string[]
): Promise<RunTarget[]> => {
  const allTargets: RunTarget[] = [];
  const targetSpinner = spinner();
  targetSpinner.start('Discovering available targets...');

  if (selectedPlatforms.includes('android')) {
    try {
      const androidPlatform = await import(
        '@react-native-harness/platform-android'
      );
      const targets: RunTarget[] = await androidPlatform.getRunTargets();
      allTargets.push(...targets);
    } catch (e) {
      console.error('Failed to load Android targets:', e);
    }
  }

  if (selectedPlatforms.includes('ios')) {
    try {
      const applePlatform = await import(
        '@react-native-harness/platform-apple'
      );
      const targets: RunTarget[] = await applePlatform.getRunTargets();
      allTargets.push(...targets);
    } catch (e) {
      console.error('Failed to load iOS targets:', e);
    }
  }

  if (selectedPlatforms.includes('web')) {
    try {
      const webPlatform = await import('@react-native-harness/platform-web');
      const targets: RunTarget[] = await webPlatform.getRunTargets();
      allTargets.push(...targets);
    } catch (e) {
      console.error('Failed to load Web targets:', e);
    }
  }

  targetSpinner.stop('Target discovery complete.');

  if (allTargets.length === 0) {
    cancelPromptAndExit('No available targets (emulators or devices) found.');
  }

  const options = allTargets.map((target, index) => {
    let platformLabel = 'Unknown';
    if (target.platform === 'android') platformLabel = 'Android';
    else if (target.platform === 'ios') platformLabel = 'iOS';
    else if (target.platform === 'web') platformLabel = 'Web';

    return {
      value: index,
      label: `[${platformLabel}] ${target.name} (${target.type})`,
      hint: target.description,
    };
  });

  const selectedTargetIndices = await promptAutocompleteMultiselect<number>({
    message: 'Select targets to support in Harness',
    options,
  });

  if (selectedTargetIndices.length === 0) {
    cancelPromptAndExit('At least one target must be selected.');
  }

  return selectedTargetIndices.map((i) => allTargets[i]);
};
