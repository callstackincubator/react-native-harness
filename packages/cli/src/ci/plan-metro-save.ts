import {
  createHarnessCache,
  type CacheSnapshot,
  type DomainSavePlan,
  type SavePolicy,
} from '@react-native-harness/cache';
import { getConfig } from '@react-native-harness/config';
import { getFs } from '@react-native-harness/tools/harness-context';
import { formatMegabytes } from './format-bytes.js';
import { resolveMetroStaticInputs } from './metro-cache-inputs.js';
import { resolveProjectRoot } from './workspace-root.js';

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

/**
 * Single-line, grep-friendly job-log report of the save decision and its
 * reason, so a skipped "Save Metro cache" step is never a mystery: it
 * distinguishes "nothing changed" from "changed but blocked by policy".
 */
const logMetroSaveDecision = (
  plan: DomainSavePlan | undefined,
  policy: SavePolicy
): void => {
  if (!plan) {
    return;
  }

  const { delta, shouldSave, saveKey } = plan;

  if (delta.addedEntries + delta.removedEntries === 0) {
    console.info('Metro cache: unchanged — skipping save.');
    return;
  }

  const change = `+${delta.addedEntries} files / ${formatMegabytes(delta.addedBytes)} added, ${delta.removedEntries} removed`;

  if (shouldSave) {
    console.info(
      `Metro cache: changed (${change}) — saving new entry with key "${saveKey}".`
    );
    return;
  }

  const reason =
    policy.mode === 'default-branch'
      ? 'policy "default-branch" (current branch is not the default branch)'
      : `policy "${policy.mode}"`;
  console.info(
    `Metro cache: changed (${change}) but save skipped by ${reason}.`
  );
};

export const runPlanMetroSave = async (): Promise<void> => {
  try {
    const projectRootInput = process.env.INPUT_PROJECTROOT;

    const projectRoot = resolveProjectRoot(projectRootInput);

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
    logMetroSaveDecision(metroPlan, policy);

    const output =
      `metroShouldSave=${metroPlan?.shouldSave ? 'true' : 'false'}\n` +
      `metroSaveKey=${metroPlan?.saveKey ?? ''}\n`;

    getFs().appendFileSync(githubOutput, output);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to plan Metro cache save');
    }

    process.exit(1);
  }
};
