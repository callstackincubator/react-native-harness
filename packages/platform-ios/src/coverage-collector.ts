import { spawn, logger } from '@react-native-harness/tools';
import fs from 'node:fs';
import path from 'node:path';

export const getAppDataContainer = async (
  udid: string,
  bundleId: string
): Promise<string> => {
  const { stdout } = await spawn('xcrun', [
    'simctl',
    'get_app_container',
    udid,
    bundleId,
    'data',
  ]);
  return stdout.trim();
};

export const getAppBundlePath = async (
  udid: string,
  bundleId: string
): Promise<string> => {
  const { stdout } = await spawn('xcrun', [
    'simctl',
    'get_app_container',
    udid,
    bundleId,
  ]);
  return stdout.trim();
};

const PROFRAW_DIR = '/tmp/harness-coverage';

export const collectProfrawFiles = (): string[] => {
  if (!fs.existsSync(PROFRAW_DIR)) {
    logger.debug('[coverage] Profraw directory does not exist: %s', PROFRAW_DIR);
    return [];
  }

  return fs
    .readdirSync(PROFRAW_DIR)
    .filter((f) => f.endsWith('.profraw'))
    .map((f) => path.join(PROFRAW_DIR, f));
};

export const cleanProfrawDir = (): void => {
  if (fs.existsSync(PROFRAW_DIR)) {
    for (const f of fs.readdirSync(PROFRAW_DIR)) {
      fs.unlinkSync(path.join(PROFRAW_DIR, f));
    }
    logger.debug('[coverage] Cleaned profraw directory: %s', PROFRAW_DIR);
  }
};

export const mergeProfdata = async (
  profrawFiles: string[],
  outputPath: string
): Promise<void> => {
  await spawn('xcrun', [
    'llvm-profdata',
    'merge',
    '-sparse',
    ...profrawFiles,
    '-o',
    outputPath,
  ]);
};

export const findAppExecutable = async (
  appBundlePath: string
): Promise<string> => {
  const infoPlistPath = path.join(appBundlePath, 'Info.plist');
  const { stdout } = await spawn('plutil', [
    '-extract',
    'CFBundleExecutable',
    'raw',
    infoPlistPath,
  ]);
  const executableName = stdout.trim();

  // Xcode 26+ may use a debug.dylib
  const debugDylibPath = path.join(
    appBundlePath,
    `${executableName}.debug.dylib`
  );
  if (fs.existsSync(debugDylibPath)) {
    return debugDylibPath;
  }

  return path.join(appBundlePath, executableName);
};

export const generateLcov = async (options: {
  profdataPath: string;
  binaryPath: string;
  outputPath: string;
  sourceFilters?: string[];
}): Promise<void> => {
  const { profdataPath, binaryPath, outputPath, sourceFilters } = options;

  const args = [
    'llvm-cov',
    'export',
    '-format=lcov',
    `-instr-profile=${profdataPath}`,
    binaryPath,
  ];

  if (sourceFilters) {
    for (const filter of sourceFilters) {
      args.push(`--sources=${filter}`);
    }
  }

  const { stdout } = await spawn('xcrun', args);
  fs.writeFileSync(outputPath, stdout);
};

export type CollectNativeCoverageOptions = {
  udid: string;
  bundleId: string;
  pods: string[];
  outputDir: string;
};

export const collectNativeCoverage = async (
  options: CollectNativeCoverageOptions
): Promise<string | null> => {
  const { udid, bundleId, pods, outputDir } = options;

  logger.debug('[coverage] Collecting native iOS coverage', { udid, bundleId, pods });

  const profrawFiles = collectProfrawFiles();
  if (profrawFiles.length === 0) {
    logger.debug('[coverage] No .profraw files found in %s', PROFRAW_DIR);
    return null;
  }

  logger.debug(`[coverage] Found ${profrawFiles.length} .profraw file(s)`);

  const profdataPath = path.join(outputDir, 'native-coverage.profdata');
  await mergeProfdata(profrawFiles, profdataPath);

  let appBundlePath: string;
  try {
    appBundlePath = await getAppBundlePath(udid, bundleId);
  } catch (error) {
    logger.debug('[coverage] Failed to get app bundle path', error);
    return null;
  }

  const binaryPath = await findAppExecutable(appBundlePath);
  logger.debug(`[coverage] Using binary: ${binaryPath}`);

  const lcovPath = path.join(outputDir, 'native-coverage.lcov');

  // Filter sources to only include code from the specified pods.
  // Pod source files are typically in the Pods directory under each pod name.
  const podSourceDirs = pods.map((pod) =>
    path.join(path.dirname(appBundlePath), '..', 'Pods', pod)
  );

  try {
    await generateLcov({
      profdataPath,
      binaryPath,
      outputPath: lcovPath,
      sourceFilters: podSourceDirs,
    });
  } catch (error) {
    logger.debug('[coverage] Failed to generate lcov, trying without source filters', error);
    await generateLcov({
      profdataPath,
      binaryPath,
      outputPath: lcovPath,
    });
  }

  cleanProfrawDir();

  logger.debug(`[coverage] Native coverage written to: ${lcovPath}`);
  return lcovPath;
};
