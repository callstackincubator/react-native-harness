import fs from 'node:fs';
import { createHarnessCache } from '@react-native-harness/cache';
import { getConfig } from '@react-native-harness/config';
import { resolveMetroStaticInputs } from './metro-cache-inputs.js';
import { resolveProjectRoot } from './workspace-root.js';

export const runPlanMetroRestore = async (): Promise<void> => {
  try {
    const projectRootInput = process.env.INPUT_PROJECTROOT;

    const projectRoot = resolveProjectRoot(projectRootInput);

    console.info(`Planning Metro cache restore for: ${projectRoot}`);

    const { config, projectRoot: resolvedProjectRoot } = await getConfig(
      projectRoot
    );

    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) {
      throw new Error('GITHUB_OUTPUT environment variable is not set');
    }

    const staticInputs = resolveMetroStaticInputs({
      projectRoot: resolvedProjectRoot,
      cacheVersionSalt: config.cache?.version,
    });

    const cache = createHarnessCache({ projectRoot: resolvedProjectRoot });
    const os = process.env.RUNNER_OS ?? process.platform;

    const restorePlan = cache.planRestore({
      metro: { os, staticInputs },
    });
    cache.writeKeysFile(restorePlan);

    const metroPlan = restorePlan.domains.metro;

    // Structured values are passed through GITHUB_OUTPUT as single-line JSON
    // strings, matching the `config=${JSON.stringify(...)}` convention
    // already used by shared/index.ts (parsed on the YAML side via
    // `fromJson(...)`).
    //
    // The pre-run cache snapshot is deliberately NOT taken here: this step
    // runs before the actual `actions/cache/restore` step, so the cache
    // directories are still empty at this point. It's captured by a
    // separate snapshot-metro step that runs after the restore action
    // instead (see snapshot-metro.ts).
    const output =
      `metroRestoreKey=${metroPlan?.restoreKey ?? ''}\n` +
      `metroRestorePrefixes=${JSON.stringify(
        metroPlan?.restorePrefixes ?? []
      )}\n`;

    fs.appendFileSync(githubOutput, output);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to plan Metro cache restore');
    }

    process.exit(1);
  }
};
