import { getConfig } from '@react-native-harness/config';
import { createRequire } from 'node:module';
import { resolveProjectRoot } from './workspace-root.js';

/**
 * `@react-native-harness/platform-apple` is only a devDependency of this
 * package, so it is resolved from the consuming project, which has it
 * installed whenever it defines an iOS runner.
 */
const loadPlatformApple = async (
  projectRoot: string
): Promise<typeof import('@react-native-harness/platform-apple')> => {
  const require = createRequire(import.meta.url);
  return import(
    require.resolve('@react-native-harness/platform-apple', {
      paths: [projectRoot],
    })
  );
};

const warn = (message: string) => console.info(`::warning::${message}`);

/**
 * Boots the iOS simulator a runner uses and stops its background services
 * before Harness starts. It is an optimization, so it warns instead of
 * failing the job.
 */
export const runPrepareIosSimulator = async (): Promise<void> => {
  try {
    const runnerInput = process.env.INPUT_RUNNER;
    if (!runnerInput) {
      throw new Error('Runner input is required');
    }

    const projectRoot = resolveProjectRoot(process.env.INPUT_PROJECTROOT);
    const { config, projectRoot: resolvedProjectRoot } =
      await getConfig(projectRoot);
    const runner = config.runners.find((runner) => runner.name === runnerInput);

    if (
      runner?.platformId !== 'ios' ||
      runner.config.device?.type !== 'simulator'
    ) {
      console.info('Not an iOS simulator runner; nothing to prepare.');
      return;
    }

    const { prepareCiSimulator, resolveCiSimulatorSlim } =
      await loadPlatformApple(resolvedProjectRoot);

    const slim = resolveCiSimulatorSlim(process.env.INPUT_SLIMIOSSIMULATOR, {
      githubHosted: process.env.RUNNER_ENVIRONMENT === 'github-hosted',
    });
    if (!slim) {
      console.info(
        'Simulator slimming is off for this runner; Harness boots the simulator itself.'
      );
      return;
    }

    const { name, systemVersion } = runner.config.device;
    const result = await prepareCiSimulator({ name, systemVersion });

    if (result.status === 'not-found') {
      warn(
        `No ${name} simulator for iOS ${systemVersion}; Harness will report it.`
      );
      return;
    }

    const { udid, bootedNow, slim: slimResult } = result;
    console.info(
      `${bootedNow ? 'Booted' : 'Using already booted'} ${name} (${udid}).`
    );
    for (const label of [...slimResult.stopped].sort()) {
      console.info(`stopped ${label}`);
    }
    for (const subsystem of [...slimResult.quieted].sort()) {
      console.info(`quiet   ${subsystem}`);
    }
    for (const item of [...slimResult.skipped].sort()) {
      console.info(`skip    ${item}`);
    }
    console.info(
      `Stopped ${slimResult.stopped.length} services and silenced ${slimResult.quieted.length} log subsystems in ${Math.round(slimResult.durationMs / 1000)}s.`
    );

    if (slimResult.stopped.length === 0) {
      warn('Simulator slimming stopped no services; the run will be slower.');
    }
  } catch (error) {
    warn(
      `Could not prepare the iOS simulator; Harness will boot it. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};
