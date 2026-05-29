import type { Config } from '@react-native-harness/config';
import { getConfig } from '@react-native-harness/config';

type HarnessConfigResult = Awaited<ReturnType<typeof getConfig>>;

type AddPlatformIgnorePatternOptions = {
  argv: string[];
  cwd: string;
  loadConfig?: (cwd: string) => Promise<HarnessConfigResult>;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCliFlagValue = (argv: string[], flagName: string): string | undefined => {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const prefix = `--${flagName}=`;

    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }

    if (arg === `--${flagName}`) {
      return argv[index + 1];
    }
  }

  return undefined;
};

export const createPlatformTestPathIgnorePattern = ({
  knownPlatformIds,
  platformId,
}: {
  knownPlatformIds: string[];
  platformId: string;
}): string | null => {
  const ignoredPlatformIds = knownPlatformIds
    .filter((knownPlatformId) => knownPlatformId !== platformId)
    .map(escapeRegExp);

  if (ignoredPlatformIds.length === 0) {
    return null;
  }

  return `\\.(${ignoredPlatformIds.join('|')})\\.harness\\.(?:[mc]?[jt]sx?)$`;
};

export const addJestPlatformIgnorePatternArg = async ({
  argv,
  cwd,
  loadConfig = getConfig,
}: AddPlatformIgnorePatternOptions): Promise<boolean> => {
  let configResult: HarnessConfigResult;
  try {
    configResult = await loadConfig(cwd);
  } catch {
    return false;
  }

  const selectedRunnerName =
    getCliFlagValue(argv, 'harnessRunner') ?? configResult.config.defaultRunner;
  if (!selectedRunnerName) {
    return false;
  }

  const selectedRunner = configResult.config.runners.find(
    (runner: Config['runners'][number]) => runner.name === selectedRunnerName,
  );
  if (!selectedRunner) {
    return false;
  }

  const ignorePattern = createPlatformTestPathIgnorePattern({
    knownPlatformIds: [
      ...new Set(configResult.config.runners.map((runner) => runner.platformId)),
    ],
    platformId: selectedRunner.platformId,
  });
  if (!ignorePattern) {
    return false;
  }

  argv.push('--testPathIgnorePatterns', ignorePattern);
  return true;
};
