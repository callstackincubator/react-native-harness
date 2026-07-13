import { getConfig } from '@react-native-harness/config';
import {
  getEmulatorCpuCores,
  getHostAndroidSystemImageArch,
} from '@react-native-harness/platform-android';
import path from 'node:path';
import fs from 'node:fs';

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

const getResolvedRunner = (
  runner: Awaited<ReturnType<typeof getConfig>>['config']['runners'][number]
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
      }),
    },
  };
};

const run = async (): Promise<void> => {
  try {
    const projectRootInput = process.env.INPUT_PROJECTROOT;
    const runnerInput = process.env.INPUT_RUNNER;

    if (!runnerInput) {
      throw new Error('Runner input is required');
    }

    const projectRoot = projectRootInput
      ? path.resolve(projectRootInput)
      : process.cwd();

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

    const resolvedRunner = getResolvedRunner(runner);
    const relativeProjectRoot =
      path.relative(process.cwd(), resolvedProjectRoot) || '.';
    const output = `config=${JSON.stringify(
      resolvedRunner
    )}\nprojectRoot=${relativeProjectRoot}\n`;
    fs.appendFileSync(githubOutput, output);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to load Harness configuration');
    }

    process.exit(1);
  }
};

run();
