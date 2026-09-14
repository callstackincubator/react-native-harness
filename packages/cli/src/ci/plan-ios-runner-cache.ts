import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getFs } from '@react-native-harness/tools/harness-context';
import { spawn } from '@react-native-harness/tools';
import { resolveProjectRoot } from './workspace-root.js';

/**
 * `agent-device`'s `exports` map does not expose `./package.json`, so its
 * version is read by walking `node_modules` upwards from the Apple platform
 * package that depends on it. That works for hoisted, isolated and nested
 * layouts alike.
 */
export const resolveAgentDeviceVersion = (
  projectRoot: string
): string | null => {
  const fs = getFs();
  const requireFromProject = createRequire(path.join(projectRoot, 'noop.js'));

  let startDirectory: string;

  try {
    startDirectory = path.dirname(
      requireFromProject.resolve(
        '@react-native-harness/platform-apple/package.json'
      )
    );
  } catch {
    startDirectory = projectRoot;
  }

  let directory = startDirectory;

  while (true) {
    const manifestPath = path.join(
      directory,
      'node_modules',
      'agent-device',
      'package.json'
    );

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        version?: string;
      };

      return manifest.version ?? null;
    }

    const parent = path.dirname(directory);

    if (parent === directory) {
      return null;
    }

    directory = parent;
  }
};

const getXcodeVersion = async (): Promise<string | null> => {
  try {
    const { stdout } = await spawn('xcodebuild', ['-version']);

    return stdout.trim();
  } catch {
    return null;
  }
};

/**
 * Prints the cache key for the agent-device iOS runner's DerivedData, which
 * `@react-native-harness/platform-apple` keeps in the Harness cache directory.
 * agent-device rebuilds the runner whenever its own version, Xcode or the SDK
 * changes, so the key is pinned to the installed package version and the
 * `xcodebuild -version` output.
 */
export const runPlanIosRunnerCache = async (): Promise<void> => {
  try {
    const projectRoot = resolveProjectRoot(process.env.INPUT_PROJECTROOT);
    const githubOutput = process.env.GITHUB_OUTPUT;

    if (!githubOutput) {
      throw new Error('GITHUB_OUTPUT environment variable is not set');
    }

    const agentDeviceVersion = resolveAgentDeviceVersion(projectRoot);
    const xcodeVersion = await getXcodeVersion();

    if (!agentDeviceVersion || !xcodeVersion) {
      console.info(
        'Skipping the agent-device runner cache: could not resolve the installed agent-device version or the Xcode version.'
      );

      getFs().appendFileSync(githubOutput, 'iosRunnerCacheKey=\n');

      return;
    }

    const os = process.env.RUNNER_OS ?? process.platform;
    const xcodeHash = createHash('sha256')
      .update(xcodeVersion)
      .digest('hex')
      .slice(0, 12);
    const cacheKey = `harness-agent-device-runner-${os}-${agentDeviceVersion}-${xcodeHash}`;

    console.info(`Planned agent-device runner cache key: ${cacheKey}`);

    getFs().appendFileSync(githubOutput, `iosRunnerCacheKey=${cacheKey}\n`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to plan the agent-device runner cache');
    }

    process.exit(1);
  }
};
