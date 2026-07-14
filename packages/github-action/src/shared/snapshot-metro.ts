import fs from 'node:fs';
import path from 'node:path';
import { createHarnessCache } from '@react-native-harness/cache';
import { getConfig } from '@react-native-harness/config';
import { formatMegabytes } from './format-bytes.js';

/**
 * Must run AFTER the "Restore Metro cache" step and BEFORE the test run, so
 * this snapshot reflects exactly what was restored from a prior save (empty
 * on a cache miss) -- not the pre-restore, always-empty state of a fresh
 * checkout. plan-save.ts diffs its own post-run snapshot against this one, so
 * capturing it too early would make every run look like it added the whole
 * restored cache, defeating the "only save when content actually changed"
 * policy.
 */
const run = async (): Promise<void> => {
  try {
    const projectRootInput = process.env.INPUT_PROJECTROOT;

    const projectRoot = projectRootInput
      ? path.resolve(projectRootInput)
      : process.cwd();

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

    const output = `metroSnapshot=${JSON.stringify(snapshotAfterRestore)}\n`;

    fs.appendFileSync(githubOutput, output);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to snapshot the Metro cache');
    }

    process.exit(1);
  }
};

run();
