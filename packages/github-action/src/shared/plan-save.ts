import fs from 'node:fs';
import path from 'node:path';
import {
  createHarnessCache,
  type CacheSnapshot,
  type SavePolicy,
} from '@react-native-harness/cache';
import { getConfig } from '@react-native-harness/config';
import { resolveMetroStaticInputs } from './metro-cache-inputs.js';

const parseSnapshot = (raw: string | undefined): CacheSnapshot => {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as CacheSnapshot;
  } catch (error) {
    console.warn(
      'Failed to parse the metroSnapshot input. Treating the pre-run cache state as empty.',
      error
    );
    return {};
  }
};

const parseSavePolicyMode = (
  raw: string | undefined
): SavePolicy['mode'] => {
  if (raw === 'always' || raw === 'never' || raw === 'default-branch') {
    return raw;
  }

  return 'default-branch';
};

const run = async (): Promise<void> => {
  try {
    const projectRootInput = process.env.INPUT_PROJECTROOT;

    const projectRoot = projectRootInput
      ? path.resolve(projectRootInput)
      : process.cwd();

    console.info(`Planning Metro cache save for: ${projectRoot}`);

    const { config, projectRoot: resolvedProjectRoot } = await getConfig(
      projectRoot
    );

    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) {
      throw new Error('GITHUB_OUTPUT environment variable is not set');
    }

    // Recomputed rather than threaded through GITHUB_OUTPUT from
    // plan-restore: computeMetroStaticInputs is deterministic given the same
    // repoRoot/bundlerMetroVersion/salt, so this step can run independently.
    const staticInputs = resolveMetroStaticInputs({
      projectRoot: resolvedProjectRoot,
      cacheVersionSalt: config.cache?.version,
    });

    const before = parseSnapshot(process.env.INPUT_METRO_SNAPSHOT);
    const policy: SavePolicy = {
      mode: parseSavePolicyMode(process.env.INPUT_CACHESAVEPOLICY),
      isDefaultBranch: process.env.IS_DEFAULT_BRANCH === 'true',
    };

    const cache = createHarnessCache({ projectRoot: resolvedProjectRoot });
    const os = process.env.RUNNER_OS ?? process.platform;

    const savePlan = cache.planSave(before, policy, {
      metro: { os, staticInputs },
    });
    cache.writeKeysFile(savePlan);

    const metroPlan = savePlan.domains.metro;

    const output =
      `metroShouldSave=${metroPlan?.shouldSave ? 'true' : 'false'}\n` +
      `metroSaveKey=${metroPlan?.saveKey ?? ''}\n`;

    fs.appendFileSync(githubOutput, output);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to plan Metro cache save');
    }

    process.exit(1);
  }
};

run();
