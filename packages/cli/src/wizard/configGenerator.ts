import fs from 'node:fs';
import path from 'node:path';
import type { RunTarget } from '@react-native-harness/platforms';
import type { ProjectConfig } from './projectType.js';

const q = (s: string) => `'${s.replace(/'/g, "\\'")}'`;

const getDeviceCall = (target: RunTarget): string => {
  const { device, type, platform } = target;
  if (platform === 'android') {
    if (type === 'emulator') {
      return `androidEmulator(${q(device.name)})`;
    }
    return `physicalAndroidDevice(${q(device.manufacturer)}, ${q(
      device.model
    )})`;
  }
  if (platform === 'ios') {
    if (type === 'emulator') {
      return `appleSimulator(${q(device.name)}, ${q(device.systemVersion)})`;
    }
    return `applePhysicalDevice(${q(device.name)})`;
  }
  return JSON.stringify(device);
};

const getPlatformFn = (platform: string): string => {
  if (platform === 'android') return 'androidPlatform';
  if (platform === 'ios') return 'applePlatform';
  return `${platform}Platform`;
};

export const generateConfig = (
  projectConfig: ProjectConfig,
  selectedPlatforms: string[],
  selectedTargets: RunTarget[],
  bundleIds: Record<string, string>
) => {
  const imports: string[] = [];
  if (selectedPlatforms.includes('android')) {
    const androidFactories = ['androidPlatform'];
    if (
      selectedTargets.some(
        (t) => t.platform === 'android' && t.type === 'emulator'
      )
    )
      androidFactories.push('androidEmulator');
    if (
      selectedTargets.some(
        (t) => t.platform === 'android' && t.type === 'physical'
      )
    )
      androidFactories.push('physicalAndroidDevice');

    imports.push(
      `import { ${androidFactories.join(
        ', '
      )} } from "@react-native-harness/platform-android";`
    );
  }
  if (selectedPlatforms.includes('ios')) {
    const iosFactories = ['applePlatform'];
    if (
      selectedTargets.some((t) => t.platform === 'ios' && t.type === 'emulator')
    )
      iosFactories.push('appleSimulator');
    if (
      selectedTargets.some((t) => t.platform === 'ios' && t.type === 'physical')
    )
      iosFactories.push('applePhysicalDevice');

    imports.push(
      `import { ${iosFactories.join(
        ', '
      )} } from "@react-native-harness/platform-apple";`
    );
  }
  if (selectedPlatforms.includes('web')) {
    const webFactories = ['webPlatform'];
    const browsers = new Set(
      selectedTargets
        .filter((t) => t.platform === 'web')
        .map((t) => t.device.browserType)
    );
    for (const browser of browsers) {
      if (browser) webFactories.push(browser);
    }

    imports.push(
      `import { ${webFactories.join(
        ', '
      )} } from "@react-native-harness/platform-web";`
    );
  }

  const runnerConfigs = selectedTargets.map((target) => {
    const platformFn = getPlatformFn(target.platform);
    const name = target.name.toLowerCase().replace(/\s+/g, '-');

    if (target.platform === 'web') {
      const url = bundleIds[target.platform];
      const browserCall = `${target.device.browserType}(${q(url)})`;
      return `    ${platformFn}({
      name: ${q(name)},
      browser: ${browserCall},
    }),`;
    }

    const bundleId = bundleIds[target.platform];
    const deviceCall = getDeviceCall(target);

    return `    ${platformFn}({
      name: ${q(name)},
      device: ${deviceCall},
      bundleId: ${q(bundleId)},
    }),`;
  });

  const configContent = `
${imports.join('\n')}

export default {
  entryPoint: ${q(projectConfig.entryPoint)},
  appRegistryComponentName: ${q(projectConfig.appRegistryComponentName)},

  runners: [
${runnerConfigs.join('\n')}
  ],
  defaultRunner: ${q(
    selectedTargets[0].name.toLowerCase().replace(/\s+/g, '-')
  )},
};
`;

  fs.writeFileSync(
    path.join(process.cwd(), 'rn-harness.config.mjs'),
    configContent.trim() + '\n'
  );
};
