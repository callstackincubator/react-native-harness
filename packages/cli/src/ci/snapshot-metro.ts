import path from 'node:path';
import { createHarnessCache } from '@react-native-harness/cache';
import { getConfig } from '@react-native-harness/config';
import { getFs } from '@react-native-harness/tools/harness-context';
import { formatMegabytes } from './format-bytes.js';
import { resolveProjectRoot } from './workspace-root.js';

const METRO_SNAPSHOT_FILENAME = 'metro-snapshot.json';

/**
 * Must run AFTER the "Restore Metro cache" step and BEFORE the test run, so
 * this snapshot reflects exactly what was restored from a prior save (empty
 * on a cache miss) -- not the pre-restore, always-empty state of a fresh
 * checkout. plan-save.ts diffs its own post-run snapshot against this one, so
 * capturing it too early would make every run look like it added the whole
 * restored cache, defeating the "only save when content actually changed"
 * policy.
 */
export const runSnapshotMetro = async (): Promise<void> => {
  try {
    const projectRootInput = process.env.INPUT_PROJECTROOT;

    const projectRoot = resolveProjectRoot(projectRootInput);

    console.info(`Snapshotting Metro cache for: ${projectRoot}`);

    const { projectRoot: resolvedProjectRoot } = await getConfig(projectRoot);

    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) {
      throw new Error('GITHUB_OUTPUT environment variable is not set');
    }

    const cache = createHarnessCache({ projectRoot: resolvedProjectRoot });
    const snapshotAfterRestore = cache.snapshot();

    // actions/cache/restore's cache-matched-key output, threaded in via the
    // step env; empty on a cache miss. This makes the job log state plainly
    // whether the Metro cache was actually restored.
    const restoredKey = process.env.METRO_RESTORED_KEY;
    if (restoredKey) {
      const metroEntries = snapshotAfterRestore.metro ?? [];
      const totalBytes = metroEntries.reduce(
        (sum, entry) => sum + entry.sizeBytes,
        0
      );
      console.info(
        `Metro cache: restored from key "${restoredKey}" (${metroEntries.length} files, ${formatMegabytes(totalBytes)}).`
      );
    } else {
      console.info(
        'Metro cache: no existing cache entry matched — starting cold.'
      );
    }

    // The action hands this output to plan-metro-save through an environment
    // variable, and Linux caps a single one at 128 KiB (MAX_ARG_STRLEN), which
    // the snapshot of a restored cache with a few thousand files exceeds. So
    // the snapshot goes to a file next to keys.json, outside the cached domain
    // directories, and only its path goes to GITHUB_OUTPUT.
    const snapshotPath = path.join(cache.paths.root, METRO_SNAPSHOT_FILENAME);
    getFs().mkdirSync(cache.paths.root, { recursive: true });
    getFs().writeFileSync(snapshotPath, JSON.stringify(snapshotAfterRestore));

    getFs().appendFileSync(githubOutput, `metroSnapshot=${snapshotPath}\n`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to snapshot the Metro cache');
    }

    process.exit(1);
  }
};
