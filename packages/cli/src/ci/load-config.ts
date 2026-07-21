import { getConfig } from '@react-native-harness/config';
import { getFs } from '@react-native-harness/tools/harness-context';
import { createRequire } from 'node:module';
import { relativeToWorkspaceRoot, resolveProjectRoot } from './workspace-root.js';

/**
 * `@react-native-harness/platform-android` is only a devDependency of this
 * package (the published CLI must not crash on Android-less/web-only
 * projects), so it's never imported at the top level. It's resolved from the
 * consuming project instead -- a project with an Android runner necessarily
 * has the package installed -- mirroring how metro-cache-inputs.ts resolves
 * @react-native-harness/bundler-metro from the consuming project.
 */
const loadPlatformAndroid = async (
  projectRoot: string
): Promise<
  typeof import('@react-native-harness/platform-android')
> => {
  const require = createRequire(import.meta.url);
  const platformAndroidEntry = require.resolve(
    '@react-native-harness/platform-android',
    { paths: [projectRoot] }
  );
  return import(platformAndroidEntry);
};

const resolveAvdCachingEnabled = ({
  snapshotEnabled,
}: {
  snapshotEnabled?: boolean;
}): boolean => {
  const override = process.env.HARNESS_AVD_CACHING;
  const requestedValue =
    override == null ? snapshotEnabled : override.toLowerCase() === 'true';

  return requestedValue === true;
};

const getNormalizedAvdCacheConfig = ({
  emulator,
  hostArch,
  getEmulatorCpuCores,
}: {
  emulator: {
    name: string;
    avd?: {
      apiLevel: number;
      profile: string;
      diskSize: string;
      heapSize: string;
    };
  };
  hostArch: 'x86_64' | 'arm64-v8a' | 'armeabi-v7a';
  getEmulatorCpuCores: () => number;
}) => {
  const avd = emulator.avd;

  if (!avd) {
    return null;
  }

  return {
    name: emulator.name,
    apiLevel: avd.apiLevel,
    arch: hostArch,
    profile: avd.profile.trim().toLowerCase(),
    diskSize: avd.diskSize.trim().toLowerCase(),
    heapSize: avd.heapSize.trim().toLowerCase(),
    // Roll the AVD cache key whenever the baked-in vCPU count changes, so a
    // cached AVD built before this constant existed regenerates once instead
    // of failing the compatibility check on every run.
    cpuCores: getEmulatorCpuCores(),
  };
};

const getResolvedRunner = async (
  runner: Awaited<ReturnType<typeof getConfig>>['config']['runners'][number],
  projectRoot: string
) => {
  if (
    runner.platformId !== 'android' ||
    runner.config.device.type !== 'emulator'
  ) {
    return runner;
  }

  const avdCachingEnabled = resolveAvdCachingEnabled({
    snapshotEnabled: runner.config.device.avd?.snapshot?.enabled,
  });

  const { getEmulatorCpuCores, getHostAndroidSystemImageArch } =
    await loadPlatformAndroid(projectRoot);

  return {
    ...runner,
    config: {
      ...runner.config,
      device: {
        ...runner.config.device,
        avd: runner.config.device.avd,
      },
    },
    action: {
      avdCachingEnabled,
      avdCacheConfig: getNormalizedAvdCacheConfig({
        emulator: runner.config.device,
        hostArch: getHostAndroidSystemImageArch(),
        getEmulatorCpuCores,
      }),
    },
  };
};

export const runLoadConfig = async (): Promise<void> => {
  try {
    const projectRootInput = process.env.INPUT_PROJECTROOT;
    const runnerInput = process.env.INPUT_RUNNER;

    if (!runnerInput) {
      throw new Error('Runner input is required');
    }

    const projectRoot = resolveProjectRoot(projectRootInput);

    console.info(`Loading React Native Harness config from: ${projectRoot}`);

    const { config, projectRoot: resolvedProjectRoot } = await getConfig(
      projectRoot
    );

    const runner = config.runners.find((runner) => runner.name === runnerInput);

    if (!runner) {
      throw new Error(`Runner ${runnerInput} not found in config`);
    }

    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) {
      throw new Error('GITHUB_OUTPUT environment variable is not set');
    }

    const resolvedRunner = await getResolvedRunner(runner, resolvedProjectRoot);
    const relativeProjectRoot = relativeToWorkspaceRoot(resolvedProjectRoot);
    const output = `config=${JSON.stringify(
      resolvedRunner
    )}\nprojectRoot=${relativeProjectRoot}\n`;
    getFs().appendFileSync(githubOutput, output);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to load Harness configuration');
    }

    process.exit(1);
  }
};
